import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { listBranches } from "../azureDevOps/branches.js";
import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { getConnectionData } from "../azureDevOps/identity.js";
import { getProject, listProjects } from "../azureDevOps/projects.js";
import { getCloneLinks, getRepository, listRepositories } from "../azureDevOps/repositories.js";
import { createToolResponse, resolveProject, runReadTool } from "./helpers.js";

export function registerCoreTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "check_azure_devops_auth",
    {
      title: "Check Azure DevOps authentication",
      description: "Verify authentication and optional project access without exposing credentials.",
      inputSchema: {
        project: z.string().trim().min(1).optional().describe("Optional project name or ID. Omit to use AZURE_DEVOPS_DEFAULT_PROJECT when configured.")
      }
    },
    async ({ project }) => {
      try {
        const resolvedProject = project ?? client.defaultProject;
        const [connection, projectResult] = await Promise.all([
          getConnectionData(client),
          resolvedProject ? getProject(client, resolvedProject) : Promise.resolve(null)
        ]);
        const projects = projectResult ? null : await listProjects(client, { top: 1 });
        return createToolResponse({
          authenticated: true,
          organization: client.organization,
          authMode: client.authMode,
          authenticatedUser: connection.authenticatedUser
            ? {
                id: connection.authenticatedUser.id ?? null,
                displayName: connection.authenticatedUser.displayName ?? null,
                uniqueName: connection.authenticatedUser.uniqueName ?? null
              }
            : null,
          defaultProject: client.defaultProject ?? null,
          project: projectResult,
          projectListingAccessible: projects !== null,
          writeToolsEnabled: client.writeToolsEnabled,
          error: null
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Azure DevOps authentication check failed";
        return createToolResponse({
          authenticated: false,
          organization: client.organization,
          authMode: client.authMode,
          authenticatedUser: null,
          defaultProject: client.defaultProject ?? null,
          project: null,
          projectListingAccessible: false,
          writeToolsEnabled: client.writeToolsEnabled,
          error: { code: "auth_check_failed", message }
        });
      }
    }
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Azure DevOps projects",
      description: "List projects in the configured Azure DevOps organization.",
      inputSchema: {
        top: z.number().int().positive().max(1_000).optional().describe("Maximum projects to return."),
        continuationToken: z.string().trim().min(1).optional().describe("Continuation token returned by a previous call."),
        stateFilter: z.enum(["all", "wellFormed", "createPending", "deleting", "new"]).optional()
      }
    },
    async ({ top, continuationToken, stateFilter }) =>
      runReadTool({ organization: client.organization }, async () => {
        const page = await listProjects(client, {
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {}),
          ...(stateFilter ? { stateFilter } : {})
        });
        return { projects: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      })
  );

  server.registerTool(
    "list_repositories",
    {
      title: "List repositories",
      description: "List Azure Repos Git repositories in a project.",
      inputSchema: {
        project: z.string().trim().min(1).optional().describe("Project name or ID. Omit to use AZURE_DEVOPS_DEFAULT_PROJECT.")
      }
    },
    async ({ project }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject }, async () => ({
        repositories: await listRepositories(client, resolvedProject)
      }));
    }
  );

  server.registerTool(
    "get_repository",
    {
      title: "Get repository",
      description: "Get Azure Repos repository metadata.",
      inputSchema: {
        project: z.string().trim().min(1).optional(),
        repositoryId: z.string().trim().min(1).describe("Repository name or ID.")
      }
    },
    async ({ project, repositoryId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId }, async () => ({
        repository: await getRepository(client, resolvedProject, repositoryId)
      }));
    }
  );

  server.registerTool(
    "get_clone_links",
    {
      title: "Get clone links",
      description: "Return HTTPS, SSH, and web URLs for an Azure Repos repository.",
      inputSchema: {
        project: z.string().trim().min(1).optional(),
        repositoryId: z.string().trim().min(1).describe("Repository name or ID.")
      }
    },
    async ({ project, repositoryId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId }, async () => ({
        cloneLinks: await getCloneLinks(client, resolvedProject, repositoryId)
      }));
    }
  );

  server.registerTool(
    "list_branches",
    {
      title: "List branches",
      description: "List branches in an Azure Repos repository.",
      inputSchema: {
        project: z.string().trim().min(1).optional(),
        repositoryId: z.string().trim().min(1).describe("Repository name or ID."),
        filter: z.string().trim().optional().describe("Optional branch-name prefix."),
        top: z.number().int().positive().max(1_000).optional(),
        continuationToken: z.string().trim().min(1).optional()
      }
    },
    async ({ project, repositoryId, filter, top, continuationToken }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId }, async () => {
        const page = await listBranches(client, resolvedProject, repositoryId, {
          ...(filter !== undefined ? { filter } : {}),
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {})
        });
        return { branches: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );
}
