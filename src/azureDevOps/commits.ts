import type { AzureDevOpsClient } from "./client.js";
import { pullRequestPath, repositoryPath } from "./paths.js";
import type { GitCommitRef, PageResult } from "../types.js";

export interface ListCommitsOptions {
  revision?: string;
  versionType?: "branch" | "tag" | "commit";
  top?: number;
  skip?: number;
  fromDate?: string;
  toDate?: string;
  author?: string;
}

export async function listCommits(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  options: ListCommitsOptions = {}
): Promise<PageResult<GitCommitRef>> {
  return client.getPage<GitCommitRef>(repositoryPath(project, repositoryId, "commits"), {
    ...(options.revision ? { "searchCriteria.itemVersion.version": normalizeRevision(options.revision) } : {}),
    ...(options.revision ? { "searchCriteria.itemVersion.versionType": options.versionType ?? inferVersionType(options.revision) } : {}),
    ...(options.top !== undefined ? { "searchCriteria.$top": options.top } : {}),
    ...(options.skip !== undefined ? { "searchCriteria.$skip": options.skip } : {}),
    ...(options.fromDate ? { "searchCriteria.fromDate": options.fromDate } : {}),
    ...(options.toDate ? { "searchCriteria.toDate": options.toDate } : {}),
    ...(options.author ? { "searchCriteria.author": options.author } : {})
  });
}

export async function getPullRequestCommits(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  options: { top?: number; continuationToken?: string } = {}
): Promise<PageResult<GitCommitRef>> {
  return client.getPage<GitCommitRef>(pullRequestPath(project, repositoryId, pullRequestId, "commits"), {
    ...(options.top !== undefined ? { "$top": options.top } : {}),
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {})
  });
}

function normalizeRevision(revision: string): string {
  return revision.replace(/^refs\/(heads|tags)\//, "");
}

function inferVersionType(revision: string): "branch" | "tag" | "commit" {
  if (revision.startsWith("refs/tags/")) return "tag";
  if (/^[0-9a-f]{40}$/i.test(revision)) return "commit";
  return "branch";
}
