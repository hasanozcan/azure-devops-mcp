import type { AzureDevOpsClient } from "./client.js";
import { projectPath, repositoryPath } from "./paths.js";
import type { AzureDevOpsListResponse, AzureDevOpsRepository } from "../types.js";

export async function listRepositories(client: AzureDevOpsClient, project: string): Promise<AzureDevOpsRepository[]> {
  const response = await client.get<AzureDevOpsListResponse<AzureDevOpsRepository>>(projectPath(project, "_apis/git/repositories"), {
    includeHidden: false,
    includeAllUrls: true,
    includeLinks: true
  });
  return response.value ?? [];
}

export async function getRepository(client: AzureDevOpsClient, project: string, repositoryIdOrName: string): Promise<AzureDevOpsRepository> {
  return client.get<AzureDevOpsRepository>(repositoryPath(project, repositoryIdOrName), {
    includeParent: true
  });
}

export async function getCloneLinks(client: AzureDevOpsClient, project: string, repositoryIdOrName: string) {
  const repository = await getRepository(client, project, repositoryIdOrName);
  return {
    repositoryId: repository.id,
    repositoryName: repository.name,
    https: repository.remoteUrl ?? null,
    ssh: repository.sshUrl ?? null,
    web: repository.webUrl ?? null
  };
}
