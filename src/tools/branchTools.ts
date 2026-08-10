import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { compareBranches, createBranch, deleteBranch, listStaleBranches } from "../azureDevOps/branchLifecycle.js";
import { authorizeMutation, resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional();
const repositorySchema = z.string().trim().min(1);
const branchSchema = z.string().trim().min(1).max(512);
const shaSchema = z.string().trim().regex(/^[0-9a-f]{40}$/i, "Must be an exact 40-character Git object ID");
const confirmSchema = z.boolean().describe("Must be true to perform the mutation.");

export function registerBranchTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "create_branch",
    {
      title: "Create branch",
      description: "Create a branch at an exact source commit, failing safely if the branch already exists.",
      inputSchema: { project: projectSchema, repositoryId: repositorySchema, branchName: branchSchema, sourceObjectId: shaSchema, confirm: confirmSchema }
    },
    async ({ project, repositoryId, branchName, sourceObjectId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, branchName }, async () => ({
        result: await createBranch(client, resolvedProject, repositoryId, branchName, sourceObjectId)
      }));
    }
  );

  server.registerTool(
    "delete_branch",
    {
      title: "Delete branch",
      description: "Delete a branch only if it still points at the exact expected commit.",
      inputSchema: { project: projectSchema, repositoryId: repositorySchema, branchName: branchSchema, expectedObjectId: shaSchema, confirm: confirmSchema }
    },
    async ({ project, repositoryId, branchName, expectedObjectId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, branchName }, async () => ({
        result: await deleteBranch(client, resolvedProject, repositoryId, branchName, expectedObjectId)
      }));
    }
  );

  server.registerTool(
    "compare_branches",
    {
      title: "Compare branches",
      description: "Compare two branches and return ahead/behind counts, common commit, and changed items.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        baseBranch: branchSchema,
        targetBranch: branchSchema,
        top: z.number().int().positive().max(2_000).optional()
      }
    },
    async ({ project, repositoryId, baseBranch, targetBranch, top }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, baseBranch, targetBranch }, async () => ({
        comparison: await compareBranches(client, resolvedProject, repositoryId, baseBranch, targetBranch, top ?? 100)
      }));
    }
  );

  server.registerTool(
    "list_stale_branches",
    {
      title: "List stale branches",
      description: "Find branches whose latest commit is older than a configured age; main, master, and develop are protected by default.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        staleDays: z.number().int().positive().max(3_650).optional(),
        top: z.number().int().positive().max(500).optional(),
        protectedBranches: z.array(branchSchema).max(100).optional()
      }
    },
    async ({ project, repositoryId, staleDays, top, protectedBranches }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId }, async () => ({
        ...(await listStaleBranches(client, resolvedProject, repositoryId, {
          ...(staleDays !== undefined ? { staleDays } : {}),
          ...(top !== undefined ? { top } : {}),
          ...(protectedBranches ? { protectedBranches } : {})
        }))
      }));
    }
  );
}
