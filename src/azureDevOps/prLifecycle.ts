import type { AzureDevOpsClient } from "./client.js";
import { getCurrentIdentity } from "./identity.js";
import { pullRequestPath } from "./paths.js";
import type { AzureDevOpsListResponse, AzureDevOpsPullRequest, PullRequestReviewer } from "../types.js";
import type { PullRequestMergeStrategy } from "./mutations.js";

export interface PullRequestLabel {
  id?: string;
  name: string;
  active?: boolean;
  url?: string;
}

export async function updatePullRequest(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  changes: { title?: string; description?: string; isDraft?: boolean; status?: "active" | "abandoned" }
): Promise<AzureDevOpsPullRequest> {
  if (Object.keys(changes).length === 0) throw new Error("At least one pull request change is required");
  return client.patch<AzureDevOpsPullRequest>(pullRequestPath(project, repositoryId, pullRequestId), changes, { "api-version": "7.1" });
}

export async function setPullRequestAutoComplete(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  options: {
    enabled: boolean;
    mergeStrategy?: PullRequestMergeStrategy;
    deleteSourceBranch?: boolean;
    transitionWorkItems?: boolean;
    mergeCommitMessage?: string;
  }
): Promise<AzureDevOpsPullRequest> {
  const identity = options.enabled ? await getCurrentIdentity(client) : null;
  return client.patch<AzureDevOpsPullRequest>(
    pullRequestPath(project, repositoryId, pullRequestId),
    {
      autoCompleteSetBy: identity ? { id: identity.id } : null,
      ...(options.enabled
        ? {
            completionOptions: {
              mergeStrategy: options.mergeStrategy ?? "squash",
              deleteSourceBranch: options.deleteSourceBranch ?? false,
              transitionWorkItems: options.transitionWorkItems ?? false,
              bypassPolicy: false,
              ...(options.mergeCommitMessage ? { mergeCommitMessage: options.mergeCommitMessage } : {})
            }
          }
        : {})
    },
    { "api-version": "7.1" }
  );
}

export async function addPullRequestReviewer(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  reviewerId: string,
  isRequired = false
): Promise<PullRequestReviewer> {
  return client.put<PullRequestReviewer>(
    pullRequestPath(project, repositoryId, pullRequestId, `reviewers/${encodeURIComponent(reviewerId)}`),
    { vote: 0, isRequired },
    { "api-version": "7.1" }
  );
}

export async function removePullRequestReviewer(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  reviewerId: string
): Promise<void> {
  await client.delete(pullRequestPath(project, repositoryId, pullRequestId, `reviewers/${encodeURIComponent(reviewerId)}`), { "api-version": "7.1" });
}

export async function listPullRequestLabels(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number
): Promise<PullRequestLabel[]> {
  const response = await client.get<AzureDevOpsListResponse<PullRequestLabel>>(pullRequestPath(project, repositoryId, pullRequestId, "labels"), {
    "api-version": "7.1"
  });
  return response.value ?? [];
}

export async function addPullRequestLabel(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  name: string
): Promise<PullRequestLabel> {
  return client.post<PullRequestLabel>(pullRequestPath(project, repositoryId, pullRequestId, "labels"), { name }, { "api-version": "7.1" });
}

export async function removePullRequestLabel(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number,
  labelIdOrName: string
): Promise<void> {
  await client.delete(pullRequestPath(project, repositoryId, pullRequestId, `labels/${encodeURIComponent(labelIdOrName)}`), {
    "api-version": "7.1"
  });
}
