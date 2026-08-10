import { createTwoFilesPatch } from "diff";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { getPullRequestIteration, getPullRequestIterationChanges, getLatestPullRequestIteration } from "../azureDevOps/iterations.js";
import { getFileContentAtCommit, normalizeRepositoryPath } from "../azureDevOps/items.js";
import { getPullRequest } from "../azureDevOps/pullRequests.js";
import type {
  FileDiffResult,
  PullRequestChange,
  PullRequestDiffBundle,
  PullRequestIteration
} from "../types.js";

const CACHE_TTL_MS = 2 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 25;
const DEFAULT_MAX_FILES = 100;
const DIFF_CONCURRENCY = 4;

export interface PullRequestDiffContext {
  iteration: PullRequestIteration;
  iterationId: number;
  baseCommitId: string;
  sourceCommitId: string;
  changes: PullRequestChange[];
  changesTruncated: boolean;
}

export interface InlineTargetInput {
  path: string;
  fromLine?: number;
  toLine?: number;
  startFromLine?: number;
  startToLine?: number;
  iterationId?: number;
}

interface CacheEntry {
  expiresAt: number;
  value: PullRequestDiffBundle;
}

export class PullRequestDiffService {
  readonly #client: AzureDevOpsClient;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(client: AzureDevOpsClient) {
    this.#client = client;
  }

  async getContext(
    project: string,
    repositoryId: string,
    pullRequestId: number,
    iterationId?: number
  ): Promise<PullRequestDiffContext> {
    const iteration = iterationId === undefined
      ? await getLatestPullRequestIteration(this.#client, project, repositoryId, pullRequestId)
      : await getPullRequestIteration(this.#client, project, repositoryId, pullRequestId, iterationId);

    let baseCommitId = iteration.commonRefCommit?.commitId ?? iteration.targetRefCommit?.commitId;
    let sourceCommitId = iteration.sourceRefCommit?.commitId;

    if (!baseCommitId || !sourceCommitId) {
      const pullRequest = await getPullRequest(this.#client, project, repositoryId, pullRequestId);
      baseCommitId ??= pullRequest.lastMergeTargetCommit?.commitId;
      sourceCommitId ??= pullRequest.lastMergeSourceCommit?.commitId;
    }

    if (!baseCommitId || !sourceCommitId) {
      throw new Error(`Unable to resolve base/source commits for pull request ${pullRequestId}, iteration ${iteration.id}`);
    }

    const { changes, truncated } = await getPullRequestIterationChanges(
      this.#client,
      project,
      repositoryId,
      pullRequestId,
      iteration.id,
      { compareTo: 0, maxChanges: 10_000 }
    );

    return {
      iteration,
      iterationId: iteration.id,
      baseCommitId,
      sourceCommitId,
      changes,
      changesTruncated: truncated
    };
  }

  async getBundle(
    project: string,
    repositoryId: string,
    pullRequestId: number,
    options: { iterationId?: number; maxFiles?: number; contextLines?: number } = {}
  ): Promise<PullRequestDiffBundle> {
    const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    const cacheKey = `${project}\n${repositoryId}\n${pullRequestId}\n${options.iterationId ?? "latest"}\n${maxFiles}\n${options.contextLines ?? 3}`;
    const cached = this.#cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const context = await this.getContext(project, repositoryId, pullRequestId, options.iterationId);
    const fileChanges = context.changes.filter((change) => !change.item.isFolder && Boolean(change.item.path));
    const selected = fileChanges.slice(0, maxFiles);
    const files = await mapWithConcurrency(selected, DIFF_CONCURRENCY, (change) =>
      this.createFileDiff(project, repositoryId, context, change, options.contextLines ?? 3)
    );

    const bundle: PullRequestDiffBundle = {
      project,
      repositoryId,
      pullRequestId,
      iterationId: context.iterationId,
      baseCommitId: context.baseCommitId,
      sourceCommitId: context.sourceCommitId,
      files,
      totalFiles: fileChanges.length,
      processedFiles: files.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      binaryFiles: files.filter((file) => file.binary).length,
      oversizedFiles: files.filter((file) => file.tooLarge).length,
      truncated: context.changesTruncated || selected.length < fileChanges.length
    };

    this.setCache(cacheKey, bundle);
    return bundle;
  }

  async getFileDiff(
    project: string,
    repositoryId: string,
    pullRequestId: number,
    path: string,
    options: { iterationId?: number; contextLines?: number } = {}
  ): Promise<{ context: PullRequestDiffContext; file: FileDiffResult }> {
    const context = await this.getContext(project, repositoryId, pullRequestId, options.iterationId);
    const change = findChangeByPath(context.changes, path);
    if (!change) {
      throw new Error(`File '${path}' is not part of pull request ${pullRequestId}, iteration ${context.iterationId}`);
    }
    const file = await this.createFileDiff(project, repositoryId, context, change, options.contextLines ?? 3);
    return { context, file };
  }

  async createFileDiff(
    project: string,
    repositoryId: string,
    context: PullRequestDiffContext,
    change: PullRequestChange,
    contextLines: number
  ): Promise<FileDiffResult> {
    const path = normalizeRepositoryPath(change.item.path);
    const originalPath = change.originalPath ? normalizeRepositoryPath(change.originalPath) : undefined;
    const changeType = change.changeType.toLowerCase();

    try {
      const oldContent = isAdd(changeType)
        ? ""
        : await getFileContentAtCommit(this.#client, project, repositoryId, originalPath ?? path, context.baseCommitId);
      const newContent = isDelete(changeType)
        ? ""
        : await getFileContentAtCommit(this.#client, project, repositoryId, path, context.sourceCommitId);

      const oldLineCount = countTextLines(oldContent);
      const newLineCount = countTextLines(newContent);
      const binary = isBinaryText(oldContent) || isBinaryText(newContent);
      const tooLarge = Buffer.byteLength(oldContent, "utf8") > this.#client.maxDiffFileBytes
        || Buffer.byteLength(newContent, "utf8") > this.#client.maxDiffFileBytes;

      if (binary || tooLarge) {
        return {
          path,
          ...(originalPath ? { originalPath } : {}),
          changeType: change.changeType,
          changeTrackingId: change.changeTrackingId,
          oldCommitId: context.baseCommitId,
          newCommitId: context.sourceCommitId,
          additions: 0,
          deletions: 0,
          oldLineCount,
          newLineCount,
          binary,
          tooLarge,
          patch: null,
          message: binary ? "Binary content is not rendered as a unified diff" : `File exceeds ${this.#client.maxDiffFileBytes} byte diff limit`
        };
      }

      const patch = createTwoFilesPatch(
        `a${originalPath ?? path}`,
        `b${path}`,
        oldContent,
        newContent,
        context.baseCommitId.slice(0, 12),
        context.sourceCommitId.slice(0, 12),
        { context: contextLines }
      );
      const stats = countPatchChanges(patch);

      return {
        path,
        ...(originalPath ? { originalPath } : {}),
        changeType: change.changeType,
        changeTrackingId: change.changeTrackingId,
        oldCommitId: context.baseCommitId,
        newCommitId: context.sourceCommitId,
        additions: stats.additions,
        deletions: stats.deletions,
        oldLineCount,
        newLineCount,
        binary: false,
        tooLarge: false,
        patch
      };
    } catch (error) {
      return {
        path,
        ...(originalPath ? { originalPath } : {}),
        changeType: change.changeType,
        changeTrackingId: change.changeTrackingId,
        oldCommitId: context.baseCommitId,
        newCommitId: context.sourceCommitId,
        additions: 0,
        deletions: 0,
        oldLineCount: 0,
        newLineCount: 0,
        binary: false,
        tooLarge: false,
        patch: null,
        message: error instanceof Error ? error.message : "Failed to build file diff"
      };
    }
  }

  clearCache(): void {
    this.#cache.clear();
  }

  private setCache(key: string, value: PullRequestDiffBundle): void {
    for (const [cacheKey, entry] of this.#cache) {
      if (entry.expiresAt <= Date.now()) this.#cache.delete(cacheKey);
    }
    while (this.#cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#cache.delete(oldest);
    }
    this.#cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }
}

export function buildUnifiedDiff(bundle: PullRequestDiffBundle, options: { startLine?: number; maxLines?: number } = {}) {
  const fullDiff = bundle.files.map((file) => file.patch).filter((patch): patch is string => Boolean(patch)).join("\n");
  const lines = splitLines(fullDiff);
  const startLine = Math.max(1, options.startLine ?? 1);
  const maxLines = Math.max(1, options.maxLines ?? 1_000);
  const startIndex = Math.min(lines.length, startLine - 1);
  const selected = lines.slice(startIndex, startIndex + maxLines);
  return {
    text: selected.join("\n"),
    startLine,
    endLine: selected.length === 0 ? startLine - 1 : startLine + selected.length - 1,
    totalLines: lines.length,
    truncated: startIndex > 0 || startIndex + selected.length < lines.length
  };
}

export function findChangeByPath(changes: PullRequestChange[], path: string): PullRequestChange | undefined {
  const normalized = normalizeRepositoryPath(path);
  return changes.find((change) => {
    const current = normalizeRepositoryPath(change.item.path);
    const original = change.originalPath ? normalizeRepositoryPath(change.originalPath) : undefined;
    return current === normalized || original === normalized;
  });
}

export function countTextLines(text: string): number {
  if (text.length === 0) return 0;
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.split("\n").length - 1 : normalized.split("\n").length;
}

export function getTextLine(text: string, line: number): string | undefined {
  if (line <= 0 || text.length === 0) return undefined;
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  return lines[line - 1];
}

function isAdd(changeType: string): boolean {
  return changeType.split(/[, ]+/).includes("add");
}

function isDelete(changeType: string): boolean {
  return changeType.split(/[, ]+/).includes("delete");
}

function isBinaryText(value: string): boolean {
  return value.includes("\u0000");
}

function countPatchChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of splitLines(patch)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function splitLines(value: string): string[] {
  if (!value) return [];
  return value.replace(/\r\n/g, "\n").split("\n");
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await map(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
