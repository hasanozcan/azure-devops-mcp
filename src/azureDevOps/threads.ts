import type { AzureDevOpsClient } from "./client.js";
import { pullRequestPath } from "./paths.js";
import type { PageResult, PullRequestComment, PullRequestThread } from "../types.js";

export async function getPullRequestThreads(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  options: { iteration?: number; baseIteration?: number; top?: number; continuationToken?: string } = {}
): Promise<PageResult<PullRequestThread>> {
  return client.getPage<PullRequestThread>(pullRequestPath(project, repositoryId, pullRequestId, "threads"), {
    ...(options.iteration !== undefined ? { "$iteration": options.iteration } : {}),
    ...(options.baseIteration !== undefined ? { "$baseIteration": options.baseIteration } : {}),
    ...(options.top !== undefined ? { "$top": options.top } : {}),
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {})
  });
}

export async function getPullRequestThreadComments(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  threadId: number
): Promise<PageResult<PullRequestComment>> {
  return client.getPage<PullRequestComment>(pullRequestPath(project, repositoryId, pullRequestId, `threads/${threadId}/comments`));
}
