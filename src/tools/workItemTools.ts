import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { getWorkItem, getWorkItemComments, queryWorkItems } from "../azureDevOps/workItems.js";
import { resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional().describe("Project name or ID. Uses AZURE_DEVOPS_DEFAULT_PROJECT when omitted.");
const workItemIdSchema = z.number().int().positive().describe("Azure Boards work item ID.");
const fieldsSchema = z
  .array(z.string().trim().min(1).max(256))
  .min(1)
  .max(200)
  .optional()
  .describe("Optional Azure Boards field reference names, for example System.Title or System.Description.");

export function registerWorkItemTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "get_work_item",
    {
      title: "Get work item",
      description: "Get one Azure Boards work item by ID, including all fields and relations by default.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        fields: fieldsSchema,
        asOf: z.string().trim().min(1).optional().describe("Optional UTC date-time for a historical snapshot."),
        expand: z.enum(["none", "relations", "fields", "links", "all"]).optional().describe("Expansion mode; defaults to all unless fields is supplied.")
      }
    },
    async ({ project, workItemId, fields, asOf, expand }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId }, async () => ({
        workItem: await getWorkItem(client, resolvedProject, workItemId, {
          ...(fields ? { fields } : {}),
          ...(asOf ? { asOf } : {}),
          ...(expand ? { expand } : {})
        })
      }));
    }
  );

  server.registerTool(
    "query_work_items",
    {
      title: "Query work items",
      description: "Run a read-only WIQL SELECT query and resolve matching Azure Boards work item details.",
      inputSchema: {
        project: projectSchema,
        wiql: z.string().trim().min(1).max(32_000).regex(/^SELECT\b/i, "WIQL must start with SELECT"),
        top: z.number().int().positive().max(1_000).optional().describe("Maximum query results; defaults to 100."),
        timePrecision: z.boolean().optional(),
        fields: fieldsSchema
      }
    },
    async ({ project, wiql, top, timePrecision, fields }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject }, async () => {
        const result = await queryWorkItems(client, resolvedProject, wiql, {
          ...(top !== undefined ? { top } : {}),
          ...(timePrecision !== undefined ? { timePrecision } : {}),
          ...(fields ? { fields } : {})
        });
        return {
          queryResult: result.queryResult,
          workItems: result.workItems,
          pagination: { count: result.workItems.length, requestedTop: top ?? 100 }
        };
      });
    }
  );

  server.registerTool(
    "get_work_item_comments",
    {
      title: "Get work item comments",
      description: "List pageable comments for one Azure Boards work item.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        top: z.number().int().positive().max(1_000).optional(),
        continuationToken: z.string().trim().min(1).optional(),
        includeDeleted: z.boolean().optional(),
        expand: z.enum(["none", "reactions", "renderedText", "renderedTextOnly", "all"]).optional(),
        order: z.enum(["asc", "desc"]).optional()
      }
    },
    async ({ project, workItemId, top, continuationToken, includeDeleted, expand, order }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId }, async () => {
        const page = await getWorkItemComments(client, resolvedProject, workItemId, {
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {}),
          ...(includeDeleted !== undefined ? { includeDeleted } : {}),
          ...(expand ? { expand } : {}),
          ...(order ? { order } : {})
        });
        return {
          comments: page.comments,
          pagination: {
            count: page.count,
            totalCount: page.totalCount,
            continuationToken: page.continuationToken ?? null,
            nextPage: page.nextPage ?? null
          }
        };
      });
    }
  );
}
