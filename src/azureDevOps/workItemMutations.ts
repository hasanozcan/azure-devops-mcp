import type { AzureDevOpsClient } from "./client.js";
import { projectPath } from "./paths.js";
import { getWorkItem, type WorkItem, type WorkItemRelation } from "./workItems.js";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface JsonPatchOperation {
  op: "add" | "remove" | "replace" | "test";
  path: string;
  value?: unknown;
}

export interface CreateWorkItemOptions {
  title: string;
  description?: string;
  assignedTo?: string;
  iterationPath?: string;
  areaPath?: string;
  tags?: string[];
  fields?: Record<string, unknown>;
  validateOnly?: boolean;
  suppressNotifications?: boolean;
}

export async function createWorkItem(
  client: AzureDevOpsClient,
  project: string,
  workItemType: string,
  options: CreateWorkItemOptions
): Promise<WorkItem> {
  const fields: Record<string, unknown> = {
    ...(options.fields ?? {}),
    "System.Title": options.title,
    ...(options.description !== undefined ? { "System.Description": options.description } : {}),
    ...(options.assignedTo !== undefined ? { "System.AssignedTo": options.assignedTo } : {}),
    ...(options.iterationPath !== undefined ? { "System.IterationPath": options.iterationPath } : {}),
    ...(options.areaPath !== undefined ? { "System.AreaPath": options.areaPath } : {}),
    ...(options.tags !== undefined ? { "System.Tags": uniqueTags(options.tags).join("; ") } : {})
  };

  return client.postJsonPatch<WorkItem>(
    projectPath(project, `_apis/wit/workitems/$${encodeURIComponent(workItemType)}`),
    Object.entries(fields).map(([field, value]) => fieldOperation("add", field, value)),
    {
      "api-version": "7.1",
      ...(options.validateOnly !== undefined ? { validateOnly: options.validateOnly } : {}),
      ...(options.suppressNotifications !== undefined ? { suppressNotifications: options.suppressNotifications } : {})
    }
  );
}

export async function updateWorkItem(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number,
  options: {
    fields?: Record<string, unknown>;
    removeFields?: string[];
    expectedRevision?: number;
    validateOnly?: boolean;
    suppressNotifications?: boolean;
  }
): Promise<WorkItem> {
  if (Object.keys(options.fields ?? {}).length === 0 && (options.removeFields ?? []).length === 0) {
    throw new Error("At least one field update or removal is required");
  }
  const operations: JsonPatchOperation[] = [];
  if (options.expectedRevision !== undefined) {
    operations.push({ op: "test", path: "/rev", value: options.expectedRevision });
  }
  for (const [field, value] of Object.entries(options.fields ?? {})) {
    operations.push(fieldOperation("add", field, value));
  }
  for (const field of [...new Set(options.removeFields ?? [])]) {
    operations.push({ op: "remove", path: `/fields/${escapeJsonPointer(field)}` });
  }
  return client.patchJsonPatch<WorkItem>(
    projectPath(project, `_apis/wit/workitems/${workItemId}`),
    operations,
    {
      "api-version": "7.1",
      ...(options.validateOnly !== undefined ? { validateOnly: options.validateOnly } : {}),
      ...(options.suppressNotifications !== undefined ? { suppressNotifications: options.suppressNotifications } : {})
    }
  );
}

export type WorkItemRelationKind =
  | "parent"
  | "child"
  | "related"
  | "predecessor"
  | "successor"
  | "duplicate"
  | "duplicateOf";

const RELATION_TYPES: Record<WorkItemRelationKind, string> = {
  parent: "System.LinkTypes.Hierarchy-Reverse",
  child: "System.LinkTypes.Hierarchy-Forward",
  related: "System.LinkTypes.Related",
  predecessor: "System.LinkTypes.Dependency-Reverse",
  successor: "System.LinkTypes.Dependency-Forward",
  duplicate: "System.LinkTypes.Duplicate-Forward",
  duplicateOf: "System.LinkTypes.Duplicate-Reverse"
};

export async function addWorkItemRelation(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number,
  targetWorkItemId: number,
  kind: WorkItemRelationKind,
  options: { comment?: string; expectedRevision?: number } = {}
): Promise<WorkItem> {
  if (workItemId === targetWorkItemId) throw new Error("A work item cannot be related to itself");
  const target = await getWorkItem(client, project, targetWorkItemId, { expand: "none" });
  if (!target.url) throw new Error(`Work item ${targetWorkItemId} did not return a relation URL`);
  const relation: WorkItemRelation = {
    rel: RELATION_TYPES[kind],
    url: target.url,
    ...(options.comment ? { attributes: { comment: options.comment } } : {})
  };
  const operations: JsonPatchOperation[] = [
    ...(options.expectedRevision === undefined ? [] : [{ op: "test" as const, path: "/rev", value: options.expectedRevision }]),
    { op: "add", path: "/relations/-", value: relation }
  ];
  return client.patchJsonPatch<WorkItem>(projectPath(project, `_apis/wit/workitems/${workItemId}`), operations, { "api-version": "7.1" });
}

export async function addWorkItemAttachment(
  client: AzureDevOpsClient,
  project: string,
  workItemId: number,
  options: { fileName: string; contentBase64: string; comment?: string; expectedRevision?: number }
): Promise<{ workItem: WorkItem; attachment: { id?: string; url: string } }> {
  const normalized = options.contentBase64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("contentBase64 is not valid base64");
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0) throw new Error("Attachment content cannot be empty");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit`);

  const attachment = await client.postRaw<{ id?: string; url: string }>(
    projectPath(project, "_apis/wit/attachments"),
    new Blob([new Uint8Array(bytes)]),
    "application/octet-stream",
    { fileName: options.fileName, "api-version": "7.1" }
  );
  if (!attachment.url) throw new Error("Azure DevOps did not return an attachment URL");
  const relation: WorkItemRelation = {
    rel: "AttachedFile",
    url: attachment.url,
    attributes: { name: options.fileName, ...(options.comment ? { comment: options.comment } : {}) }
  };
  const operations: JsonPatchOperation[] = [
    ...(options.expectedRevision === undefined ? [] : [{ op: "test" as const, path: "/rev", value: options.expectedRevision }]),
    { op: "add", path: "/relations/-", value: relation }
  ];
  const workItem = await client.patchJsonPatch<WorkItem>(projectPath(project, `_apis/wit/workitems/${workItemId}`), operations, { "api-version": "7.1" });
  return { workItem, attachment };
}

function fieldOperation(op: "add" | "replace", field: string, value: unknown): JsonPatchOperation {
  return { op, path: `/fields/${escapeJsonPointer(field)}`, value };
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
