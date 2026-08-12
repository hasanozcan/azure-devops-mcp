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
import { registerBoardWriteTools } from "./tools/boardWriteTools.js";
import { registerBranchTools } from "./tools/branchTools.js";
import { registerPipelineTools } from "./tools/pipelineTools.js";
import { registerPrLifecycleTools } from "./tools/prLifecycleTools.js";
import { registerPullRequestTools } from "./tools/pullRequestTools.js";
import { registerQualityTools } from "./tools/qualityTools.js";
import { registerReviewTools } from "./tools/reviewTools.js";
import { registerSprintTools } from "./tools/sprintTools.js";
import { registerWorkItemTools } from "./tools/workItemTools.js";
import { registerWriteTools } from "./tools/writeTools.js";

export function createServer(client: AzureDevOpsClient = new AzureDevOpsClient(loadConfig().azureDevOps)): McpServer {
  const server = new McpServer(
    {
      name: "azure-devops-mcp",
      version: "0.3.0"
    },
    {
      instructions:
        "Azure DevOps Services MCP server for Boards, Repos, pull request review, Pipelines, sprints, backlog planning, and delivery reporting. Read tools are enabled by default. Mutations require both AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true and confirm=true; policy bypass is never used.",
      capabilities: {
        tools: {}
      }
    }
  );

  const diffService = new PullRequestDiffService(client);
  registerCoreTools(server, client);
  registerWorkItemTools(server, client);
  registerBoardWriteTools(server, client);
  registerPullRequestTools(server, client);
  registerReviewTools(server, client, diffService);
  registerWriteTools(server, client, diffService);
  registerPrLifecycleTools(server, client);
  registerBranchTools(server, client);
  registerPipelineTools(server, client);
  registerSprintTools(server, client);
  registerQualityTools(server, client);
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
