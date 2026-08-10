import type { AzureDevOpsClient } from "./client.js";
import { repositoryPath } from "./paths.js";

export async function getFileContentAtCommit(
  client: AzureDevOpsClient,
  project: string,
  repositoryId: string,
  path: string,
  commitId: string
): Promise<string> {
  return client.getText(repositoryPath(project, repositoryId, "items"), {
    path: normalizeRepositoryPath(path),
    includeContent: true,
    download: false,
    "$format": "text",
    "versionDescriptor.version": commitId,
    "versionDescriptor.versionType": "commit"
  });
}

export function normalizeRepositoryPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (!trimmed) {
    throw new Error("Repository path cannot be empty");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
