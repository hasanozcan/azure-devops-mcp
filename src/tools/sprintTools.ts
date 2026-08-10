import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import {
  getIterationVelocity,
  getIterationWorkItems,
  getTeamCapacity,
  listTeamIterations,
  reorderBacklogWorkItems
} from "../azureDevOps/sprints.js";
import { authorizeMutation, resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional();
const teamSchema = z.string().trim().min(1).max(512).optional().describe("Team name or ID. Omit to use the project's default team context.");
const iterationIdSchema = z.string().trim().min(1).max(256);

export function registerSprintTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "list_team_iterations",
    {
      title: "List team iterations",
      description: "List current, past, future, or all sprint iterations for a team.",
      inputSchema: { project: projectSchema, team: teamSchema, timeframe: z.enum(["current", "past", "future"]).optional() }
    },
    async ({ project, team, timeframe }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, team: team ?? null }, async () => ({
        iterations: await listTeamIterations(client, resolvedProject, team, timeframe)
      }));
    }
  );

  server.registerTool(
    "get_iteration_work_items",
    {
      title: "Get iteration work items",
      description: "Get work items assigned to a team iteration/sprint.",
      inputSchema: { project: projectSchema, team: teamSchema, iterationId: iterationIdSchema }
    },
    async ({ project, team, iterationId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, team: team ?? null, iterationId }, async () =>
        getIterationWorkItems(client, resolvedProject, team, iterationId)
      );
    }
  );

  server.registerTool(
    "get_team_capacity",
    {
      title: "Get team capacity",
      description: "Get per-team-member sprint capacity, activities, and days off.",
      inputSchema: { project: projectSchema, team: teamSchema, iterationId: iterationIdSchema }
    },
    async ({ project, team, iterationId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, team: team ?? null, iterationId }, async () => ({
        capacity: await getTeamCapacity(client, resolvedProject, team, iterationId)
      }));
    }
  );

  server.registerTool(
    "get_iteration_velocity",
    {
      title: "Get iteration velocity",
      description: "Calculate delivered item and story-point totals for a sprint using configurable point field and completed states.",
      inputSchema: {
        project: projectSchema,
        team: teamSchema,
        iterationId: iterationIdSchema,
        pointsField: z.string().trim().min(1).max(256).optional(),
        completedStates: z.array(z.string().trim().min(1).max(256)).min(1).max(50).optional()
      }
    },
    async ({ project, team, iterationId, pointsField, completedStates }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, team: team ?? null, iterationId }, async () => ({
        velocity: await getIterationVelocity(client, resolvedProject, team, iterationId, {
          ...(pointsField ? { pointsField } : {}),
          ...(completedStates ? { completedStates } : {})
        })
      }));
    }
  );

  server.registerTool(
    "reorder_backlog_work_items",
    {
      title: "Reorder backlog work items",
      description: "Move or reorder work items in a team backlog using adjacent or parent IDs. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        team: teamSchema,
        ids: z.array(z.number().int().positive()).min(1).max(200),
        iterationPath: z.string().trim().min(1).max(4_000).optional(),
        nextId: z.number().int().nonnegative().optional().describe("Use 0 for the end of the list."),
        previousId: z.number().int().nonnegative().optional().describe("Use 0 for the beginning of the list."),
        parentId: z.number().int().nonnegative().optional().describe("Use 0 to remove a parent."),
        confirm: z.boolean().describe("Must be true to perform the mutation.")
      }
    },
    async ({ project, team, ids, iterationPath, nextId, previousId, parentId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, team: team ?? null }, async () => ({
        result: await reorderBacklogWorkItems(client, resolvedProject, team, {
          ids,
          ...(iterationPath ? { iterationPath } : {}),
          ...(nextId !== undefined ? { nextId } : {}),
          ...(previousId !== undefined ? { previousId } : {}),
          ...(parentId !== undefined ? { parentId } : {})
        })
      }));
    }
  );
}
