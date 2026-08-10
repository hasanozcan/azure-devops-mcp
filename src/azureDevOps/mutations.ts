import type { AzureDevOpsClient } from "./client.js";
import { getCurrentIdentity } from "./identity.js";
import { projectPath, pullRequestPath, repositoryPath } from "./paths.js";
import type { WorkItemComment } from "./workItems.js";
import type { AzureDevOpsPullRequest, CommentThreadStatus, PullRequestComment, PullRequestThread, PullRequestVote, PullRequestReviewer } from "../types.js";
import type { InlineTargetValidationResult } from "../review/inlineTargetValidator.js";

const WORK_ITEM_COMMENTS_API_VERSION = "7.1-preview.4";

const VOTE_VALUES: Record<PullRequestVote, number> = {
  approve: 10,
  approveWithSuggestions: 5,
  noVote: 0,
  waitForAuthor: -5,
  reject: -10
};

const THREAD_STATUS_VALUES: Record<CommentThreadStatus, number> = {
  unknown: 0,
  active: 1,
  fixed: 2,
  wontFix: 3,
  closed: 4,
  byDesign: 5,
  pending: 6
};

export interface CreatePullRequestOptions {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description?: string;
  isDraft?: boolean;
  reviewerIds?: string[];
  workItemIds?: number[];
  supportsIterations?: boolean;
}

export async function addWorkItemComment(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number,
  text: string,
  format: "markdown" | "html" = "markdown"
): Promise<WorkItemComment> {
  return client.post<WorkItemComment>(
    projectPath(project, `_apis/wit/workItems/${workItemId}/comments`),
    { text },
    { format, "api-version": WORK_ITEM_COMMENTS_API_VERSION }
  );
}

export async function createPullRequest(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  options: CreatePullRequestOptions
): Promise<AzureDevOpsPullRequest> {
  const reviewerIds = [...new Set(options.reviewerIds ?? [])];
  const workItemIds = [...new Set(options.workItemIds ?? [])];
  return client.post<AzureDevOpsPullRequest>(
    repositoryPath(project, repositoryId, "pullrequests"),
    {
      sourceRefName: normalizeBranchRef(options.sourceBranch),
      targetRefName: normalizeBranchRef(options.targetBranch),
      title: options.title,
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.isDraft !== undefined ? { isDraft: options.isDraft } : {}),
      ...(reviewerIds.length > 0 ? { reviewers: reviewerIds.map((id) => ({ id })) } : {}),
      ...(workItemIds.length > 0 ? { workItemRefs: workItemIds.map((id) => ({ id: String(id) })) } : {})
    },
    {
      "api-version": "7.1",
      ...(options.supportsIterations !== undefined ? { supportsIterations: options.supportsIterations } : {})
    }
  );
}

export async function createPullRequestComment(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  content: string
): Promise<PullRequestThread> {
  return client.post<PullRequestThread>(pullRequestPath(project, repositoryId, pullRequestId, "threads"), {
    comments: [{ parentCommentId: 0, content, commentType: 1 }],
    status: THREAD_STATUS_VALUES.active
  });
}

export async function createPullRequestInlineComment(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  content: string,
  validation: InlineTargetValidationResult
): Promise<PullRequestThread> {
  if (!validation.valid || validation.changeTrackingId === null) {
    throw new Error(validation.message || "Inline comment target is invalid");
  }

  return client.post<PullRequestThread>(pullRequestPath(project, repositoryId, pullRequestId, "threads"), {
    comments: [{ parentCommentId: 0, content, commentType: 1 }],
    status: THREAD_STATUS_VALUES.active,
    threadContext: {
      filePath: validation.path,
      leftFileStart: validation.leftFileStart,
      leftFileEnd: validation.leftFileEnd,
      rightFileStart: validation.rightFileStart,
      rightFileEnd: validation.rightFileEnd
    },
    pullRequestThreadContext: {
      changeTrackingId: validation.changeTrackingId,
      iterationContext: {
        firstComparingIteration: validation.firstComparingIteration,
        secondComparingIteration: validation.secondComparingIteration
      }
    }
  });
}

export async function replyToPullRequestThread(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  threadId: number,
  content: string,
  parentCommentId = 1
): Promise<PullRequestComment> {
  return client.post<PullRequestComment>(pullRequestPath(project, repositoryId, pullRequestId, `threads/${threadId}/comments`), {
    parentCommentId,
    content,
    commentType: 1
  });
}

export async function updatePullRequestThreadStatus(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  threadId: number,
  status: Exclude<CommentThreadStatus, "unknown">
): Promise<PullRequestThread> {
  return client.patch<PullRequestThread>(pullRequestPath(project, repositoryId, pullRequestId, `threads/${threadId}`), {
    status: THREAD_STATUS_VALUES[status]
  });
}

export async function setPullRequestVote(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  vote: PullRequestVote
): Promise<{ reviewer: PullRequestReviewer; identity: { id: string; displayName?: string; uniqueName?: string }; vote: PullRequestVote; voteValue: number }> {
  const identity = await getCurrentIdentity(client);
  const voteValue = VOTE_VALUES[vote];
  const reviewer = await client.put<PullRequestReviewer>(
    pullRequestPath(project, repositoryId, pullRequestId, `reviewers/${encodeURIComponent(identity.id)}`),
    { vote: voteValue }
  );
  return {
    reviewer,
    identity: {
      id: identity.id,
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
      ...(identity.uniqueName ? { uniqueName: identity.uniqueName } : {})
    },
    vote,
    voteValue
  };
}

function normalizeBranchRef(value: string): string {
  if (value.startsWith("refs/heads/")) return value;
  if (value.startsWith("refs/")) throw new Error("Pull request branches must use refs/heads/<branch> refs");
  return `refs/heads/${value}`;
}
