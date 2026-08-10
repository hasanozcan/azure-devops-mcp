import type { AzureDevOpsClient } from "./client.js";
import { listBranches, type BranchSummary } from "./branches.js";
import { listCommits } from "./commits.js";
import { repositoryPath } from "./paths.js";
import type { GitCommitRef } from "../types.js";

const ZERO_OBJECT_ID = "0".repeat(40);

export interface GitRefUpdateResult {
  name: string;
  oldObjectId?: string;
  newObjectId?: string;
  success: boolean;
  updateStatus?: string;
  customMessage?: string;
}

export async function createBranch(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  branchName: string,
  sourceObjectId: string
): Promise<GitRefUpdateResult> {
  const [result] = await client.post<GitRefUpdateResult[]>(
    repositoryPath(project, repositoryId, "refs"),
    [{ name: normalizeBranchRef(branchName), oldObjectId: ZERO_OBJECT_ID, newObjectId: sourceObjectId }],
    { "api-version": "7.1" }
  );
  if (!result) throw new Error("Azure DevOps returned no branch creation result");
  return result;
}

export async function deleteBranch(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  branchName: string,
  expectedObjectId: string
): Promise<GitRefUpdateResult> {
  const [result] = await client.post<GitRefUpdateResult[]>(
    repositoryPath(project, repositoryId, "refs"),
    [{ name: normalizeBranchRef(branchName), oldObjectId: expectedObjectId, newObjectId: ZERO_OBJECT_ID }],
    { "api-version": "7.1" }
  );
  if (!result) throw new Error("Azure DevOps returned no branch deletion result");
  return result;
}

export interface BranchComparison {
  aheadCount?: number;
  behindCount?: number;
  allChangesIncluded?: boolean;
  commonCommit?: string;
  changes?: Array<Record<string, unknown>>;
}

export async function compareBranches(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  baseBranch: string,
  targetBranch: string,
  top = 100
): Promise<BranchComparison> {
  return client.get<BranchComparison>(repositoryPath(project, repositoryId, "diffs/commits"), {
    baseVersion: stripBranchRef(baseBranch),
    baseVersionType: "branch",
    targetVersion: stripBranchRef(targetBranch),
    targetVersionType: "branch",
    $top: top,
    "api-version": "7.1"
  });
}

export interface StaleBranch extends BranchSummary {
  latestCommit: GitCommitRef | null;
  lastCommitDate: string | null;
  ageDays: number | null;
}

export async function listStaleBranches(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  options: { staleDays?: number; top?: number; protectedBranches?: string[] } = {}
): Promise<{ cutoff: string; branches: StaleBranch[] }> {
  const staleDays = options.staleDays ?? 90;
  const cutoffMs = Date.now() - staleDays * 86_400_000;
  const cutoff = new Date(cutoffMs).toISOString();
  const protectedNames = new Set((options.protectedBranches ?? ["main", "master", "develop"]).map(stripBranchRef));
  const page = await listBranches(client, project, repositoryId, { top: options.top ?? 200 });
  const candidates = page.items.filter((branch) => !protectedNames.has(branch.name));
  const inspected = await mapWithConcurrency(candidates, 8, async (branch): Promise<StaleBranch | null> => {
    const commits = await listCommits(client, project, repositoryId, { revision: branch.name, versionType: "branch", top: 1 });
    const latestCommit = commits.items[0] ?? null;
    const date = latestCommit?.committer?.date ?? latestCommit?.author?.date ?? null;
    const time = date ? Date.parse(date) : Number.NaN;
    if (date && Number.isFinite(time) && time >= cutoffMs) return null;
    return {
      ...branch,
      latestCommit,
      lastCommitDate: date,
      ageDays: Number.isFinite(time) ? Math.floor((Date.now() - time) / 86_400_000) : null
    };
  });
  return { cutoff, branches: inspected.filter((branch): branch is StaleBranch => branch !== null) };
}

function normalizeBranchRef(value: string): string {
  if (value.startsWith("refs/heads/")) return value;
  if (value.startsWith("refs/")) throw new Error("Branch refs must use refs/heads/<branch>");
  return `refs/heads/${value}`;
}

function stripBranchRef(value: string): string {
  return value.replace(/^refs\/heads\//, "");
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, callback: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await callback(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
