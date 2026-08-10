#!/usr/bin/env node
import "dotenv/config";

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AzureDevOpsClient } from "./azureDevOps/client.js";
import { loadConfig } from "./config.js";
import { PullRequestDiffService } from "./review/diffEngine.js";
import { registerCoreTools } from "./tools/coreTools.js";
import { registerPullRequestTools } from "./tools/pullRequestTools.js";
import { registerReviewTools } from "./tools/reviewTools.js";
import { registerWorkItemTools } from "./tools/workItemTools.js";
import { registerWriteTools } from "./tools/writeTools.js";

export function createServer(client: AzureDevOpsClient = new AzureDevOpsClient(loadConfig().azureDevOps)): McpServer {
  const server = new McpServer(
    {
      name: "azure-devops-mcp",
      version: "0.1.0"
    },
    {
      instructions:
        "Focused Azure DevOps Services server for Azure Repos, Azure Boards work items, and pull request review. Read tools are enabled by default. Mutations require both AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true and confirm=true.",
      capabilities: {
        tools: {}
      }
    }
  );

  const diffService = new PullRequestDiffService(client);
  registerCoreTools(server, client);
  registerWorkItemTools(server, client);
  registerPullRequestTools(server, client);
  registerReviewTools(server, client, diffService);
  registerWriteTools(server, client, diffService);
  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && fileURLToPath(import.meta.url) === resolve(entry!);
}

if (isMainModule()) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`azure-devops-mcp failed to start: ${message}\n`);
    process.exitCode = 1;
  });
}
