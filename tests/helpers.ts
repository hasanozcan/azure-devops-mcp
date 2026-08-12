import { AzureDevOpsClient, type FetchLike } from "../src/azureDevOps/client.js";
import { PatAuthProvider } from "../src/azureDevOps/auth.js";
import type { AzureDevOpsConfig } from "../src/types.js";

export function makeConfig(overrides: Partial<AzureDevOpsConfig> = {}): AzureDevOpsConfig {
  return {
    organization: "contoso",
    baseUrl: "https://dev.azure.com",
    apiVersion: "7.1",
    authMode: "pat",
    pat: "unit-test-pat",
    defaultProject: "Project One",
    userAgent: "azure-devops-mcp-tests/0.3.0",
    requestTimeoutMs: 1_000,
    retryCount: 0,
    writeToolsEnabled: false,
    maxDiffFileBytes: 1_048_576,
    maxDiffLines: 5_000,
    ...overrides
  };
}

export function makeClient(fetch: FetchLike, overrides: Partial<AzureDevOpsConfig> = {}): AzureDevOpsClient {
  return new AzureDevOpsClient(makeConfig(overrides), {
    auth: new PatAuthProvider(overrides.pat ?? "unit-test-pat"),
    fetch
  });
}

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init
  });
}
