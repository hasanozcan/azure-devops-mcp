import type { AzureDevOpsClient } from "./client.js";
import { pullRequestPath } from "./paths.js";
import type { AzureDevOpsListResponse, ResourceRef } from "../types.js";

export interface WorkItem {
  id: number;
  rev?: number;
  url?: string;
  fields?: Record<string, unknown>;
}

const DEFAULT_WORK_ITEM_FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AssignedTo",
  "System.AreaPath",
  "System.IterationPath"
];

export async function getPullRequestWorkItemRefs(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number
): Promise<ResourceRef[]> {
  const response = await client.get<AzureDevOpsListResponse<ResourceRef>>(pullRequestPath(project, repositoryId, pullRequestId, "workitems"));
  return response.value ?? [];
}

export async function getWorkItemsBatch(client: AzureDevOpsClient, ids: number[], fields = DEFAULT_WORK_ITEM_FIELDS): Promise<WorkItem[]> {
  if (ids.length === 0) return [];
  const response = await client.get<AzureDevOpsListResponse<WorkItem>>("_apis/wit/workitems", {
    ids: ids.join(","),
    fields: fields.join(","),
    errorPolicy: "Omit"
  });
  return response.value ?? [];
}

export async function getPullRequestWorkItems(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  pullRequestId: number
): Promise<{ refs: ResourceRef[]; workItems: WorkItem[] }> {
  const refs = await getPullRequestWorkItemRefs(client, project, repositoryId, pullRequestId);
  const ids = refs.map((ref) => Number(ref.id)).filter((id) => Number.isInteger(id) && id > 0);
  const workItems = await getWorkItemsBatch(client, ids);
  return { refs, workItems };
}
