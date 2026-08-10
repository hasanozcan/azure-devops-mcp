import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { AzureDevOpsClientError, isAzureDevOpsNotFoundError } from "../azureDevOps/client.js";
import { resolveProject as resolveConfiguredProject } from "../azureDevOps/paths.js";

export interface ToolError {
  code: "not_found" | "unauthorized" | "forbidden" | "request_failed";
  message: string;
  status?: number;
  requestId?: string;
}

export function createToolResponse<T extends Record<string, unknown>>(structuredContent: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent, null, 2)
      }
    ],
    structuredContent
  };
}

export function resolveProject(client: AzureDevOpsClient, project: string | undefined): string {
  return resolveConfiguredProject(client.defaultProject, project);
}

export async function runReadTool<T extends Record<string, unknown>>(
  context: Record<string, unknown>,
  read: () => Promise<T>
) {
  try {
    return createToolResponse({
      ...context,
      ...(await read()),
      error: null
    });
  } catch (error) {
    if (!(error instanceof AzureDevOpsClientError)) {
      throw error;
    }

    return createToolResponse({
      ...context,
      error: normalizeToolError(error)
    });
  }
}

export function normalizeToolError(error: AzureDevOpsClientError): ToolError {
  let code: ToolError["code"] = "request_failed";
  if (isAzureDevOpsNotFoundError(error)) code = "not_found";
  else if (error.status === 401) code = "unauthorized";
  else if (error.status === 403) code = "forbidden";

  return {
    code,
    message: error.message,
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {})
  };
}

export function requireConfirmation(confirm: boolean): void {
  if (confirm !== true) {
    throw new Error("Mutation requires confirm=true");
  }
}

export function requireWriteToolsEnabled(client: AzureDevOpsClient): void {
  if (!client.writeToolsEnabled) {
    throw new Error("Mutation tools are disabled. Set AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true to enable them.");
  }
}

export function authorizeMutation(client: AzureDevOpsClient, confirm: boolean): void {
  requireWriteToolsEnabled(client);
  requireConfirmation(confirm);
}
