import type { AzureDevOpsClient } from "./client.js";
import type { AzureDevOpsProject, PageResult } from "../types.js";

export interface ListProjectsOptions {
  continuationToken?: string;
  top?: number;
  stateFilter?: "all" | "wellFormed" | "createPending" | "deleting" | "new";
}

export async function listProjects(client: AzureDevOpsClient, options: ListProjectsOptions = {}): Promise<PageResult<AzureDevOpsProject>> {
  return client.getPage<AzureDevOpsProject>("_apis/projects", {
    ...(options.continuationToken ? { continuationToken: options.continuationToken } : {}),
    ...(options.top !== undefined ? { "$top": options.top } : {}),
    ...(options.stateFilter ? { stateFilter: options.stateFilter } : {})
  });
}

export async function getProject(client: AzureDevOpsClient, projectIdOrName: string): Promise<AzureDevOpsProject> {
  return client.get<AzureDevOpsProject>(`_apis/projects/${encodeURIComponent(projectIdOrName)}`);
}
