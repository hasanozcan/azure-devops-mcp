import type { AzureDevOpsClient } from "./client.js";
import { projectPath, pullRequestPath } from "./paths.js";
import type { AzureDevOpsListResponse, IdentityRef, ResourceRef } from "../types.js";

const WORK_ITEM_BATCH_SIZE = 200;
const DEFAULT_QUERY_TOP = 100;
const COMMENTS_API_VERSION = "7.1-preview.4";

export interface WorkItem {
  id: number;
  rev?: number;
  url?: string;
  fields?: Record<string, unknown>;
  relations?: WorkItemRelation[];
  _links?: Record<string, unknown>;
}

export interface WorkItemRelation {
  rel?: string;
  url: string;
  attributes?: Record<string, unknown>;
}

export interface WorkItemReference {
  id: number;
  url?: string;
}

export interface WorkItemQueryRelation {
  rel?: string;
  source?: WorkItemReference | null;
  target?: WorkItemReference | null;
}

export interface WorkItemQueryResult {
  queryType?: "flat" | "tree" | "oneHop" | string;
  queryResultType?: "workItem" | "workItemLink" | string;
  asOf?: string;
  columns?: Array<Record<string, unknown>>;
  sortColumns?: Array<Record<string, unknown>>;
  workItems?: WorkItemReference[];
  workItemRelations?: WorkItemQueryRelation[];
}

export interface WorkItemComment {
  id?: number;
  commentId?: number;
  workItemId: number;
  version?: number;
  text?: string;
  renderedText?: string;
  format?: "markdown" | "html" | string;
  createdBy?: IdentityRef;
  createdDate?: string;
  modifiedBy?: IdentityRef;
  modifiedDate?: string;
  isDeleted?: boolean;
  mentions?: Array<Record<string, unknown>>;
  reactions?: Array<Record<string, unknown>>;
  url?: string;
}

export interface WorkItemCommentPage {
  comments: WorkItemComment[];
  count: number;
  totalCount: number;
  continuationToken?: string;
  nextPage?: string;
}

export type WorkItemExpand = "none" | "relations" | "fields" | "links" | "all";
export type WorkItemCommentExpand = "none" | "reactions" | "renderedText" | "renderedTextOnly" | "all";

const DEFAULT_WORK_ITEM_FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AssignedTo",
  "System.AreaPath",
  "System.IterationPath",
  "System.Tags",
  "System.Reason",
  "System.CreatedBy",
  "System.CreatedDate",
  "System.ChangedBy",
  "System.ChangedDate"
];

const WORK_ITEM_EXPAND_VALUES: Record<WorkItemExpand, string> = {
  none: "None",
  relations: "Relations",
  fields: "Fields",
  links: "Links",
  all: "All"
};

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

  const found = new Map<number, WorkItem>();
  for (let offset = 0; offset < ids.length; offset += WORK_ITEM_BATCH_SIZE) {
    const batchIds = ids.slice(offset, offset + WORK_ITEM_BATCH_SIZE);
    const response = await client.get<AzureDevOpsListResponse<WorkItem>>("_apis/wit/workitems", {
      ids: batchIds.join(","),
      fields: fields.join(","),
      errorPolicy: "Omit"
    });
    for (const workItem of response.value ?? []) {
      found.set(workItem.id, workItem);
    }
  }

  return ids.flatMap((id) => {
    const workItem = found.get(id);
    return workItem ? [workItem] : [];
  });
}

export async function getWorkItem(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number,
  options: { fields?: string[]; asOf?: string; expand?: WorkItemExpand } = {}
): Promise<WorkItem> {
  const expand = options.expand ?? (options.fields ? "none" : "all");
  return client.get<WorkItem>(projectPath(project, `_apis/wit/workitems/${workItemId}`), {
    ...(options.fields ? { fields: options.fields.join(",") } : {}),
    ...(options.asOf ? { asOf: options.asOf } : {}),
    $expand: WORK_ITEM_EXPAND_VALUES[expand]
  });
}

export async function queryWorkItems(
  client: AzureDevOpsClient,
  project: string,
  wiql: string,
  options: { top?: number; timePrecision?: boolean; fields?: string[] } = {}
): Promise<{ queryResult: WorkItemQueryResult; workItems: WorkItem[] }> {
  const queryResult = await client.post<WorkItemQueryResult>(
    projectPath(project, "_apis/wit/wiql"),
    { query: wiql },
    {
      $top: options.top ?? DEFAULT_QUERY_TOP,
      ...(options.timePrecision !== undefined ? { timePrecision: options.timePrecision } : {})
    }
  );

  const ids = collectQueryWorkItemIds(queryResult);
  const workItems = await getWorkItemsBatch(client, ids, options.fields ?? DEFAULT_WORK_ITEM_FIELDS);
  return { queryResult, workItems };
}

export async function getWorkItemComments(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number,
  options: {
    top?: number;
    continuationToken?: string;
    includeDeleted?: boolean;
    expand?: WorkItemCommentExpand;
    order?: "asc" | "desc";
  } = {}
): Promise<WorkItemCommentPage> {
  const response = await client.get<WorkItemCommentPage>(projectPath(project, `_apis/wit/workItems/${workItemId}/comments`), {
    ...(options.top !== undefined ? { $top: options.top } : {}),
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {}),
    ...(options.includeDeleted !== undefined ? { includeDeleted: options.includeDeleted } : {}),
    ...(options.expand ? { $expand: options.expand } : {}),
    ...(options.order ? { order: options.order } : {}),
    "api-version": COMMENTS_API_VERSION
  });

  return {
    comments: response.comments ?? [],
    count: response.count ?? response.comments?.length ?? 0,
    totalCount: response.totalCount ?? response.count ?? response.comments?.length ?? 0,
    ...(response.continuationToken ? { continuationToken: response.continuationToken } : {}),
    ...(response.nextPage ? { nextPage: response.nextPage } : {})
  };
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

function collectQueryWorkItemIds(result: WorkItemQueryResult): number[] {
  const ids = new Set<number>();
  for (const reference of result.workItems ?? []) {
    if (Number.isInteger(reference.id) && reference.id > 0) ids.add(reference.id);
  }
  for (const relation of result.workItemRelations ?? []) {
    if (relation.source && Number.isInteger(relation.source.id) && relation.source.id > 0) ids.add(relation.source.id);
    if (relation.target && Number.isInteger(relation.target.id) && relation.target.id > 0) ids.add(relation.target.id);
  }
  return [...ids];
}
