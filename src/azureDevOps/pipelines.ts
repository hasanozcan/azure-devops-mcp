import type { AzureDevOpsClient } from "./client.js";
import { projectPath } from "./paths.js";
import type { AzureDevOpsListResponse, IdentityRef, PageResult } from "../types.js";

export interface PipelineReference {
  id: number;
  name: string;
  folder?: string;
  revision?: number;
  url?: string;
}

export interface PipelineRun {
  id: number;
  name?: string;
  state?: string;
  result?: string;
  createdDate?: string;
  finishedDate?: string;
  url?: string;
  pipeline?: PipelineReference;
  resources?: Record<string, unknown>;
  variables?: Record<string, { value?: string; isSecret?: boolean }>;
}

export interface Build {
  id: number;
  buildNumber?: string;
  status?: string;
  result?: string;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  sourceBranch?: string;
  sourceVersion?: string;
  requestedFor?: IdentityRef;
  definition?: { id?: number; name?: string };
  repository?: { id?: string; name?: string; type?: string };
  url?: string;
}

export async function listPipelines(
  client: AzureDevOpsClient,
  project: string,
  options: { top?: number; continuationToken?: string; orderBy?: string } = {}
): Promise<PageResult<PipelineReference>> {
  return client.getPage<PipelineReference>(projectPath(project, "_apis/pipelines"), {
    ...(options.top !== undefined ? { $top: options.top } : {}),
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {}),
    ...(options.orderBy ? { orderBy: options.orderBy } : {}),
    "api-version": "7.1"
  });
}

export async function listPipelineRuns(
  client: AzureDevOpsClient,
  project: string,
  pipelineId: number,
  options: { top?: number; continuationToken?: string } = {}
): Promise<PageResult<PipelineRun>> {
  return client.getPage<PipelineRun>(projectPath(project, `_apis/pipelines/${pipelineId}/runs`), {
    ...(options.top !== undefined ? { $top: options.top } : {}),
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {}),
    "api-version": "7.1"
  });
}

export async function getPipelineRun(client: AzureDevOpsClient, project: string, pipelineId: number, runId: number): Promise<PipelineRun> {
  return client.get<PipelineRun>(projectPath(project, `_apis/pipelines/${pipelineId}/runs/${runId}`), { "api-version": "7.1" });
}

export async function runPipeline(
  client: AzureDevOpsClient,
  project: string,
  pipelineId: number,
  options: {
    branch?: string;
    variables?: Record<string, string>;
    templateParameters?: Record<string, unknown>;
    stagesToSkip?: string[];
    previewRun?: boolean;
    resources?: Record<string, unknown>;
  } = {}
): Promise<PipelineRun> {
  const variableBody = options.variables
    ? Object.fromEntries(Object.entries(options.variables).map(([name, value]) => [name, { value }]))
    : undefined;
  return client.post<PipelineRun>(
    projectPath(project, `_apis/pipelines/${pipelineId}/runs`),
    {
      ...(options.resources ? { resources: options.resources } : {}),
      ...(options.branch
        ? { resources: { ...(options.resources ?? {}), repositories: { self: { refName: normalizeBranchRef(options.branch) } } } }
        : {}),
      ...(variableBody ? { variables: variableBody } : {}),
      ...(options.templateParameters ? { templateParameters: options.templateParameters } : {}),
      ...(options.stagesToSkip ? { stagesToSkip: options.stagesToSkip } : {}),
      ...(options.previewRun !== undefined ? { previewRun: options.previewRun } : {})
    },
    { "api-version": "7.1" }
  );
}

export async function rerunPipeline(
  client: AzureDevOpsClient,
  project: string,
  pipelineId: number,
  runId: number
): Promise<{ sourceRun: PipelineRun; run: PipelineRun }> {
  const sourceRun = await getPipelineRun(client, project, pipelineId, runId);
  const run = await runPipeline(client, project, pipelineId, {
    ...(sourceRun.resources ? { resources: sanitizeRunResources(sourceRun.resources) } : {})
  });
  return { sourceRun, run };
}

export interface BuildLogReference {
  id: number;
  type?: string;
  url?: string;
  lineCount?: number;
  createdOn?: string;
  lastChangedOn?: string;
}

export async function getPipelineRunLogs(
  client: AzureDevOpsClient,
  project: string,
  runId: number,
  options: { logId?: number; maxChars?: number } = {}
): Promise<{ logs?: BuildLogReference[]; logId?: number; text?: string; truncated?: boolean }> {
  const base = projectPath(project, `_apis/build/builds/${runId}/logs`);
  if (options.logId === undefined) {
    const response = await client.get<AzureDevOpsListResponse<BuildLogReference>>(base, { "api-version": "7.1" });
    return { logs: response.value ?? [] };
  }
  const maxChars = options.maxChars ?? 100_000;
  const text = await client.getText(`${base}/${options.logId}`, { "api-version": "7.1" });
  return { logId: options.logId, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

export async function listBuilds(
  client: AzureDevOpsClient,
  project: string,
  options: {
    definitionIds?: number[];
    repositoryId?: string;
    branch?: string;
    statusFilter?: string;
    resultFilter?: string;
    top?: number;
    continuationToken?: string;
  } = {}
): Promise<PageResult<Build>> {
  return client.getPage<Build>(projectPath(project, "_apis/build/builds"), {
    ...(options.definitionIds?.length ? { definitions: options.definitionIds.join(",") } : {}),
    ...(options.repositoryId ? { repositoryId: options.repositoryId, repositoryType: "TfsGit" } : {}),
    ...(options.branch ? { branchName: normalizeBranchRef(options.branch) } : {}),
    ...(options.statusFilter ? { statusFilter: options.statusFilter } : {}),
    ...(options.resultFilter ? { resultFilter: options.resultFilter } : {}),
    ...(options.top !== undefined ? { $top: options.top } : {}),
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {}),
    queryOrder: "queueTimeDescending",
    "api-version": "7.1"
  });
}

function normalizeBranchRef(value: string): string {
  return value.startsWith("refs/") ? value : `refs/heads/${value}`;
}

function sanitizeRunResources(resources: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const group of ["repositories", "pipelines", "builds", "packages", "containers"] as const) {
    const entries = resources[group];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    sanitized[group] = Object.fromEntries(
      Object.entries(entries).map(([name, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [name, {}];
        const resource = value as Record<string, unknown>;
        return [
          name,
          {
            ...(typeof resource.refName === "string" ? { refName: resource.refName } : {}),
            ...(typeof resource.version === "string" ? { version: resource.version } : {}),
            ...(typeof resource.image === "string" ? { image: resource.image } : {})
          }
        ];
      })
    );
  }
  return sanitized;
}
