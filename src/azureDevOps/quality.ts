import type { AzureDevOpsClient } from "./client.js";
import { listStaleBranches } from "./branchLifecycle.js";
import { projectPath, pullRequestPath } from "./paths.js";
import { getProject } from "./projects.js";
import { getPullRequest, getPullRequestReviewers, listPullRequests } from "./pullRequests.js";
import { getPullRequestThreads } from "./threads.js";
import { getWorkItem } from "./workItems.js";
import type { PageResult } from "../types.js";

export interface PolicyEvaluation {
  evaluationId?: string;
  status?: string;
  context?: { configuration?: { id?: number; type?: { displayName?: string } } };
  startedDate?: string;
  completedDate?: string;
}

export interface PullRequestStatus {
  id?: number;
  state?: string;
  description?: string;
  context?: { name?: string; genre?: string };
  creationDate?: string;
  updatedDate?: string;
}

export async function getPullRequestMergeReadiness(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number
): Promise<Record<string, unknown>> {
  const [projectInfo, pullRequest] = await Promise.all([
    getProject(client, project),
    getPullRequest(client, project, repositoryId, pullRequestId, { includeCommits: false, includeWorkItemRefs: true })
  ]);
  const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectInfo.id}/${pullRequestId}`;
  const [reviewers, threads, policies, statuses] = await Promise.all([
    getPullRequestReviewers(client, project, repositoryId, pullRequestId),
    getPullRequestThreads(client, project, repositoryId, pullRequestId, { top: 2_000 }),
    client.getPage<PolicyEvaluation>(projectPath(project, "_apis/policy/evaluations"), { artifactId, $top: 1_000, "api-version": "7.1-preview.1" }),
    client.getPage<PullRequestStatus>(pullRequestPath(project, repositoryId, pullRequestId, "statuses"), { "api-version": "7.1-preview.1" })
  ]);

  const blockingThreads = threads.items.filter((thread) => thread.status === "active" || thread.status === "pending");
  const rejectedReviewers = reviewers.filter((reviewer) => (reviewer.vote ?? 0) < 0);
  const unapprovedRequiredReviewers = reviewers.filter((reviewer) => reviewer.isRequired && (reviewer.vote ?? 0) < 5);
  const blockingPolicies = policies.items.filter((policy) => !["approved", "notApplicable"].includes(policy.status ?? ""));
  const blockingStatuses = statuses.items.filter((status) => ["error", "failed", "pending"].includes((status.state ?? "").toLowerCase()));
  const blockers: string[] = [];
  if (pullRequest.status !== "active") blockers.push(`Pull request status is ${pullRequest.status}`);
  if (pullRequest.isDraft) blockers.push("Pull request is a draft");
  if (pullRequest.mergeStatus && pullRequest.mergeStatus !== "succeeded") blockers.push(`Merge status is ${pullRequest.mergeStatus}`);
  if (rejectedReviewers.length) blockers.push(`${rejectedReviewers.length} reviewer vote(s) block completion`);
  if (unapprovedRequiredReviewers.length) blockers.push(`${unapprovedRequiredReviewers.length} required reviewer(s) have not approved`);
  if (blockingThreads.length) blockers.push(`${blockingThreads.length} active or pending thread(s)`);
  if (blockingPolicies.length) blockers.push(`${blockingPolicies.length} policy evaluation(s) are not approved`);
  if (blockingStatuses.length) blockers.push(`${blockingStatuses.length} PR status check(s) are pending or failed`);

  return {
    ready: blockers.length === 0,
    blockers,
    pullRequest,
    reviewerSummary: { total: reviewers.length, rejected: rejectedReviewers, unapprovedRequired: unapprovedRequiredReviewers },
    threadSummary: { total: threads.count, blocking: blockingThreads },
    policies: policies.items,
    statuses: statuses.items
  };
}

export async function getBatchPullRequestReviewSummary(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string | undefined,
  options: { status?: "active" | "abandoned" | "completed" | "all"; top?: number } = {}
): Promise<Array<Record<string, unknown>>> {
  const page = await listPullRequests(client, project, repositoryId, { status: options.status ?? "active", top: options.top ?? 20 });
  return Promise.all(
    page.items.map(async (pullRequest) => {
      const repoId = pullRequest.repository.id;
      const [reviewers, threads] = await Promise.all([
        getPullRequestReviewers(client, project, repoId, pullRequest.pullRequestId),
        getPullRequestThreads(client, project, repoId, pullRequest.pullRequestId, { top: 2_000 })
      ]);
      return {
        pullRequest,
        approvals: reviewers.filter((reviewer) => (reviewer.vote ?? 0) >= 5).length,
        blockingVotes: reviewers.filter((reviewer) => (reviewer.vote ?? 0) < 0).length,
        activeThreads: threads.items.filter((thread) => thread.status === "active" || thread.status === "pending").length
      };
    })
  );
}

export async function getStaleRepositoryReport(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  options: { staleDays?: number; top?: number; protectedBranches?: string[] } = {}
): Promise<Record<string, unknown>> {
  const staleDays = options.staleDays ?? 30;
  const cutoffMs = Date.now() - staleDays * 86_400_000;
  const [branches, pullRequests] = await Promise.all([
    listStaleBranches(client, project, repositoryId, {
      staleDays,
      top: options.top ?? 200,
      ...(options.protectedBranches ? { protectedBranches: options.protectedBranches } : {})
    }),
    listPullRequests(client, project, repositoryId, { status: "active", top: options.top ?? 200 })
  ]);
  const stalePullRequests = pullRequests.items
    .map((pullRequest) => ({ ...pullRequest, ageDays: dateAgeDays(pullRequest.creationDate) }))
    .filter((pullRequest) => !pullRequest.creationDate || Date.parse(pullRequest.creationDate) < cutoffMs);
  return { cutoff: new Date(cutoffMs).toISOString(), staleDays, staleBranches: branches.branches, stalePullRequests };
}

export async function getWorkItemDeliveryTrace(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number
): Promise<Record<string, unknown>> {
  const workItem = await getWorkItem(client, project, workItemId, { expand: "all" });
  const relations = workItem.relations ?? [];
  return {
    workItem,
    pullRequests: relations.filter((relation) => /PullRequestId/i.test(relation.url)),
    commits: relations.filter((relation) => /Commit/i.test(relation.url)),
    builds: relations.filter((relation) => /Build/i.test(relation.url)),
    branches: relations.filter((relation) => /Ref/i.test(relation.url)),
    workItemRelations: relations.filter((relation) => /workItems\//i.test(relation.url)),
    otherRelations: relations.filter((relation) => !/(PullRequestId|Commit|Build|Ref|workItems\/)/i.test(relation.url))
  };
}

export interface WorkItemUpdate {
  id?: number;
  rev?: number;
  revisedBy?: unknown;
  revisedDate?: string;
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
  relations?: Record<string, unknown>;
  url?: string;
}

export async function getWorkItemAuditHistory(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number,
  options: { top?: number; skip?: number } = {}
): Promise<PageResult<WorkItemUpdate>> {
  return client.getPage<WorkItemUpdate>(projectPath(project, `_apis/wit/workitems/${workItemId}/updates`), {
    $top: options.top ?? 200,
    ...(options.skip !== undefined ? { $skip: options.skip } : {}),
    "api-version": "7.1"
  });
}

function dateAgeDays(value: string | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor((Date.now() - timestamp) / 86_400_000) : null;
}
