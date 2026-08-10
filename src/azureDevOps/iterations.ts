import type { AzureDevOpsClient } from "./client.js";
import { pullRequestPath } from "./paths.js";
import type { PageResult, PullRequestChange, PullRequestIteration, PullRequestIterationChanges } from "../types.js";

const MAX_CHANGES_PAGE_SIZE = 2_000;

export async function listPullRequestIterations(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  options: { includeCommits?: boolean } = {}
): Promise<PageResult<PullRequestIteration>> {
  return client.getPage<PullRequestIteration>(pullRequestPath(project, repositoryId, pullRequestId, "iterations"), {
    includeCommits: options.includeCommits ?? false
  });
}

export async function getPullRequestIteration(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  iterationId: number
): Promise<PullRequestIteration> {
  return client.get<PullRequestIteration>(pullRequestPath(project, repositoryId, pullRequestId, `iterations/${iterationId}`));
}

export async function getLatestPullRequestIteration(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number
): Promise<PullRequestIteration> {
  const page = await listPullRequestIterations(client, project, repositoryId, pullRequestId);
  if (page.items.length === 0) {
    throw new Error(`Pull request ${pullRequestId} has no iterations`);
  }
  const latest = page.items.reduce((current, item) => (item.id > current.id ? item : current));
  return getPullRequestIteration(client, project, repositoryId, pullRequestId, latest.id);
}

export async function getPullRequestIterationChanges(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  iterationId: number,
  options: { compareTo?: number; maxChanges?: number } = {}
): Promise<{ changes: PullRequestChange[]; truncated: boolean }> {
  const maxChanges = options.maxChanges ?? 10_000;
  const changes: PullRequestChange[] = [];
  let skip = 0;

  while (changes.length < maxChanges) {
    const top = Math.min(MAX_CHANGES_PAGE_SIZE, maxChanges - changes.length);
    const response = await client.get<PullRequestIterationChanges>(
      pullRequestPath(project, repositoryId, pullRequestId, `iterations/${iterationId}/changes`),
      {
        "$top": top,
        "$skip": skip,
        ...(options.compareTo !== undefined ? { "$compareTo": options.compareTo } : {})
      }
    );
    const page = response.changeEntries ?? [];
    changes.push(...page);
    if (page.length < top) {
      return { changes, truncated: false };
    }
    skip += page.length;
  }

  return { changes, truncated: true };
}
