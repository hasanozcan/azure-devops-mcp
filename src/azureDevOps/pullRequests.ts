import type { AzureDevOpsClient } from "./client.js";
import { projectPath, pullRequestPath, repositoryPath } from "./paths.js";
import type { AzureDevOpsPullRequest, PageResult, PullRequestReviewer } from "../types.js";

export type PullRequestStatus = "active" | "abandoned" | "completed" | "all" | "notSet";

export interface ListPullRequestsOptions {
  status?: PullRequestStatus;
  sourceRefName?: string;
  targetRefName?: string;
  creatorId?: string;
  reviewerId?: string;
  top?: number;
  skip?: number;
}

export interface ParsedPullRequestUrl {
  organization: string;
  project: string;
  repository: string;
  pullRequestId: number;
}

export async function listPullRequests(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string | undefined,
  options: ListPullRequestsOptions = {}
): Promise<PageResult<AzureDevOpsPullRequest>> {
  const path = repositoryId
    ? repositoryPath(project, repositoryId, "pullrequests")
    : projectPath(project, "_apis/git/pullrequests");

  return client.getPage<AzureDevOpsPullRequest>(path, {
    "searchCriteria.status": options.status ?? "active",
    ...(options.sourceRefName ? { "searchCriteria.sourceRefName": normalizeRef(options.sourceRefName) } : {}),
    ...(options.targetRefName ? { "searchCriteria.targetRefName": normalizeRef(options.targetRefName) } : {}),
    ...(options.creatorId ? { "searchCriteria.creatorId": options.creatorId } : {}),
    ...(options.reviewerId ? { "searchCriteria.reviewerId": options.reviewerId } : {}),
    ...(options.top !== undefined ? { "$top": options.top } : {}),
    ...(options.skip !== undefined ? { "$skip": options.skip } : {})
  });
}

export async function getPullRequest(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  options: { includeCommits?: boolean; includeWorkItemRefs?: boolean } = {}
): Promise<AzureDevOpsPullRequest> {
  return client.get<AzureDevOpsPullRequest>(pullRequestPath(project, repositoryId, pullRequestId), {
    includeCommits: options.includeCommits ?? true,
    includeWorkItemRefs: options.includeWorkItemRefs ?? true
  });
}

export async function getPullRequestReviewers(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number
): Promise<PullRequestReviewer[]> {
  const page = await client.getPage<PullRequestReviewer>(pullRequestPath(project, repositoryId, pullRequestId, "reviewers"));
  return page.items;
}

export async function getPullRequestByUrl(client: AzureDevOpsClient, url: string): Promise<{ parsed: ParsedPullRequestUrl; pullRequest: AzureDevOpsPullRequest }> {
  const parsed = parsePullRequestUrl(url);
  if (parsed.organization.toLowerCase() !== client.organization.toLowerCase()) {
    throw new Error(`Pull request URL belongs to organization '${parsed.organization}', but this server is configured for '${client.organization}'`);
  }
  const pullRequest = await getPullRequest(client, parsed.project, parsed.repository, parsed.pullRequestId);
  return { parsed, pullRequest };
}

export function parsePullRequestUrl(value: string): ParsedPullRequestUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Azure DevOps pull request URL");
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let organization: string;
  let offset: number;

  if (url.hostname.toLowerCase() === "dev.azure.com") {
    organization = segments[0] ?? "";
    offset = 1;
  } else {
    const match = /^([^.]+)\.visualstudio\.com$/i.exec(url.hostname);
    if (!match?.[1]) {
      throw new Error("URL is not an Azure DevOps Services pull request URL");
    }
    organization = match[1];
    offset = 0;
  }

  const project = segments[offset];
  const gitMarker = segments[offset + 1]?.toLowerCase();
  const repository = segments[offset + 2];
  const prMarker = segments[offset + 3]?.toLowerCase();
  const idText = segments[offset + 4];
  const pullRequestId = Number(idText);

  if (!organization || !project || gitMarker !== "_git" || !repository || prMarker !== "pullrequest" || !Number.isInteger(pullRequestId) || pullRequestId <= 0) {
    throw new Error("URL does not match the Azure DevOps pull request format");
  }

  return { organization, project, repository, pullRequestId };
}

function normalizeRef(value: string): string {
  if (value.startsWith("refs/")) return value;
  return `refs/heads/${value}`;
}
