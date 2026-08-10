#!/usr/bin/env node
import "dotenv/config";

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AzureDevOpsClient, AzureDevOpsClientError } from "./azureDevOps/client.js";
import { getConnectionData } from "./azureDevOps/identity.js";
import { getProject, listProjects } from "./azureDevOps/projects.js";
import { listRepositories } from "./azureDevOps/repositories.js";
import { loadConfig } from "./config.js";

export async function runDoctor(): Promise<void> {
  const config = loadConfig().azureDevOps;
  const client = new AzureDevOpsClient(config);
  const connection = await getConnectionData(client);
  const project = config.defaultProject ? await getProject(client, config.defaultProject) : null;
  const projectPage = project ? null : await listProjects(client, { top: 1 });
  const repositories = project ? await listRepositories(client, project.id) : null;

  const result = {
    ok: true,
    organization: config.organization,
    baseUrl: config.baseUrl,
    apiVersion: config.apiVersion,
    authMode: config.authMode,
    authenticatedUser: connection.authenticatedUser
      ? {
          id: connection.authenticatedUser.id ?? null,
          displayName: connection.authenticatedUser.displayName ?? null,
          uniqueName: connection.authenticatedUser.uniqueName ?? null
        }
      : null,
    defaultProject: project
      ? { id: project.id, name: project.name, state: project.state ?? null }
      : null,
    projectListingAccessible: projectPage !== null,
    repositoryCount: repositories?.length ?? null,
    writeToolsEnabled: config.writeToolsEnabled,
    limits: {
      requestTimeoutMs: config.requestTimeoutMs,
      retryCount: config.retryCount,
      maxDiffFileBytes: config.maxDiffFileBytes,
      maxDiffLines: config.maxDiffLines
    }
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runDoctor().catch((error: unknown) => {
    const result = {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof AzureDevOpsClientError && error.status !== undefined ? { status: error.status } : {}),
        ...(error instanceof AzureDevOpsClientError && error.code ? { code: error.code } : {}),
        ...(error instanceof AzureDevOpsClientError && error.requestId ? { requestId: error.requestId } : {})
      }
    };
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
  });
}
