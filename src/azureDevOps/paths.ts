import { encodePathSegment } from "./client.js";

export function projectPath(project: string, suffix: string): string {
  return `${encodePathSegment(project)}/${suffix.replace(/^\/+/, "")}`;
}

export function repositoryPath(project: string, repositoryId: string, suffix = ""): string {
  const base = projectPath(project, `_apis/git/repositories/${encodePathSegment(repositoryId)}`);
  return suffix ? `${base}/${suffix.replace(/^\/+/, "")}` : base;
}

export function pullRequestPath(project: string, repositoryId: string, pullRequestId: number, suffix = ""): string {
  const base = repositoryPath(project, repositoryId, `pullRequests/${pullRequestId}`);
  return suffix ? `${base}/${suffix.replace(/^\/+/, "")}` : base;
}

export function resolveProject(defaultProject: string | undefined, project: string | undefined): string {
  const resolved = project?.trim() || defaultProject?.trim();
  if (!resolved) {
    throw new Error("project is required: no AZURE_DEVOPS_DEFAULT_PROJECT is configured");
  }
  return resolved;
}

export function stripRefPrefix(refName: string | undefined): string | undefined {
  if (!refName) return undefined;
  return refName.replace(/^refs\/(heads|tags)\//, "");
}
