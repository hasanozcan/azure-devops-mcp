import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { getFileContentAtCommit, normalizeRepositoryPath } from "../azureDevOps/items.js";
import type { CommentPosition } from "../types.js";
import { findChangeByPath, getTextLine, PullRequestDiffService, type InlineTargetInput } from "./diffEngine.js";

export interface InlineTargetValidationResult {
  valid: boolean;
  message: string;
  path: string;
  iterationId: number;
  changeTrackingId: number | null;
  firstComparingIteration: number;
  secondComparingIteration: number;
  leftFileStart: CommentPosition | null;
  leftFileEnd: CommentPosition | null;
  rightFileStart: CommentPosition | null;
  rightFileEnd: CommentPosition | null;
}

export async function validateInlineCommentTarget(
  client: AzureDevOpsClient,
  diffService: PullRequestDiffService,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  input: InlineTargetInput
): Promise<InlineTargetValidationResult> {
  if (input.fromLine === undefined && input.toLine === undefined) {
    throw new Error("Inline comments require at least one of fromLine or toLine");
  }

  const context = await diffService.getContext(project, repositoryId, pullRequestId, input.iterationId);
  const change = findChangeByPath(context.changes, input.path);
  const normalizedInputPath = normalizeRepositoryPath(input.path);
  const baseResult = {
    path: normalizedInputPath,
    iterationId: context.iterationId,
    changeTrackingId: change?.changeTrackingId ?? null,
    firstComparingIteration: 1,
    secondComparingIteration: context.iterationId
  };

  if (!change || change.item.isFolder) {
    return invalid(baseResult, `File '${input.path}' is not part of pull request ${pullRequestId}, iteration ${context.iterationId}`);
  }

  const path = normalizeRepositoryPath(change.item.path);
  const originalPath = change.originalPath ? normalizeRepositoryPath(change.originalPath) : path;
  const changeType = change.changeType.toLowerCase();
  const oldContent = hasChangeFlag(changeType, "add") ? "" : await getFileContentAtCommit(client, project, repositoryId, originalPath, context.baseCommitId);
  const newContent = hasChangeFlag(changeType, "delete") ? "" : await getFileContentAtCommit(client, project, repositoryId, path, context.sourceCommitId);

  const left = validateSide("from", oldContent, input.startFromLine, input.fromLine);
  if (!left.valid) return invalid({ ...baseResult, path }, left.message);
  const right = validateSide("to", newContent, input.startToLine, input.toLine);
  if (!right.valid) return invalid({ ...baseResult, path }, right.message);

  return {
    ...baseResult,
    valid: true,
    message: "Inline comment target is valid for the current pull request iteration",
    path,
    changeTrackingId: change.changeTrackingId,
    leftFileStart: left.start,
    leftFileEnd: left.end,
    rightFileStart: right.start,
    rightFileEnd: right.end
  };
}

function validateSide(
  label: "from" | "to",
  content: string,
  requestedStart: number | undefined,
  requestedEnd: number | undefined
): { valid: true; start: CommentPosition | null; end: CommentPosition | null } | { valid: false; message: string } {
  if (requestedEnd === undefined) {
    if (requestedStart !== undefined) {
      return { valid: false, message: `start${capitalize(label)}Line requires ${label}Line` };
    }
    return { valid: true, start: null, end: null };
  }

  const startLine = requestedStart ?? requestedEnd;
  if (startLine > requestedEnd) {
    return { valid: false, message: `start${capitalize(label)}Line cannot be greater than ${label}Line` };
  }

  const startText = getTextLine(content, startLine);
  const endText = getTextLine(content, requestedEnd);
  if (startText === undefined || endText === undefined) {
    const sideName = label === "from" ? "original" : "new";
    return { valid: false, message: `${label}Line range ${startLine}-${requestedEnd} is outside the ${sideName} file` };
  }

  return {
    valid: true,
    start: { line: startLine, offset: 1 },
    end: { line: requestedEnd, offset: Math.max(1, endText.length + 1) }
  };
}

function invalid(
  base: Pick<InlineTargetValidationResult, "path" | "iterationId" | "changeTrackingId" | "firstComparingIteration" | "secondComparingIteration">,
  message: string
): InlineTargetValidationResult {
  return {
    ...base,
    valid: false,
    message,
    leftFileStart: null,
    leftFileEnd: null,
    rightFileStart: null,
    rightFileEnd: null
  };
}

function hasChangeFlag(changeType: string, flag: string): boolean {
  return changeType.split(/[, ]+/).includes(flag);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
