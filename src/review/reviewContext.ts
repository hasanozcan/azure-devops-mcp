import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { getPullRequestCommits } from "../azureDevOps/commits.js";
import { getPullRequest, getPullRequestReviewers } from "../azureDevOps/pullRequests.js";
import { getPullRequestThreads } from "../azureDevOps/threads.js";
import { getPullRequestWorkItems } from "../azureDevOps/workItems.js";
import { buildUnifiedDiff, PullRequestDiffService } from "./diffEngine.js";

export interface ReviewContextError {
  area: string;
  message: string;
}

export async function getPullRequestReviewContext(
  client: AzureDevOpsClient,
  diffService: PullRequestDiffService,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  options: {
    diffMaxLines?: number;
    maxFiles?: number;
    includeCommits?: boolean;
    includeThreads?: boolean;
    includeReviewers?: boolean;
    includeWorkItems?: boolean;
  } = {}
) {
  const errors: ReviewContextError[] = [];
  const pullRequest = await getPullRequest(client, project, repositoryId, pullRequestId);

  const [diffBundle, commits, threads, reviewers, workItems] = await Promise.all([
    collect(errors, "diff", () => diffService.getBundle(project, repositoryId, pullRequestId, { maxFiles: options.maxFiles ?? 100 })),
    options.includeCommits === false
      ? Promise.resolve(null)
      : collect(errors, "commits", () => getPullRequestCommits(client, project, repositoryId, pullRequestId, { top: 200 })),
    options.includeThreads === false
      ? Promise.resolve(null)
      : collect(errors, "threads", () => getPullRequestThreads(client, project, repositoryId, pullRequestId, { top: 2_000 })),
    options.includeReviewers === false
      ? Promise.resolve(null)
      : collect(errors, "reviewers", () => getPullRequestReviewers(client, project, repositoryId, pullRequestId)),
    options.includeWorkItems === false
      ? Promise.resolve(null)
      : collect(errors, "workItems", () => getPullRequestWorkItems(client, project, repositoryId, pullRequestId))
  ]);

  return {
    pullRequest,
    changedFiles: diffBundle?.files.map(({ patch: _patch, ...file }) => file) ?? null,
    diffStats: diffBundle
      ? {
          iterationId: diffBundle.iterationId,
          totalFiles: diffBundle.totalFiles,
          processedFiles: diffBundle.processedFiles,
          additions: diffBundle.additions,
          deletions: diffBundle.deletions,
          binaryFiles: diffBundle.binaryFiles,
          oversizedFiles: diffBundle.oversizedFiles,
          truncated: diffBundle.truncated
        }
      : null,
    diff: diffBundle ? buildUnifiedDiff(diffBundle, { maxLines: options.diffMaxLines ?? 1_000 }) : null,
    commits,
    threads,
    reviewers,
    workItems,
    partial: errors.length > 0,
    errors
  };
}

async function collect<T>(errors: ReviewContextError[], area: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    errors.push({ area, message: error instanceof Error ? error.message : `Unknown ${area} error` });
    return null;
  }
}
