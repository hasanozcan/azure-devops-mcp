import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import {
  addWorkItemAttachment,
  addWorkItemRelation,
  createWorkItem,
  updateWorkItem
} from "../azureDevOps/workItemMutations.js";
import { authorizeMutation, resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional().describe("Project name or ID. Omit to use AZURE_DEVOPS_DEFAULT_PROJECT.");
const workItemIdSchema = z.number().int().positive().describe("Azure Boards work item ID.");
const confirmSchema = z.boolean().describe("Must be true to perform the mutation.");
const fieldsSchema = z.record(z.string().trim().min(1).max(256), z.unknown()).optional().describe("Azure Boards field reference names mapped to values.");

export function registerBoardWriteTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "create_work_item",
    {
      title: "Create work item",
      description: "Create an Azure Boards work item with standard or custom fields. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        workItemType: z.string().trim().min(1).max(128).describe("Work item type, for example User Story, Bug, Task, or Epic."),
        title: z.string().trim().min(1).max(1_024),
        description: z.string().max(150_000).optional(),
        assignedTo: z.string().trim().min(1).max(512).optional(),
        iterationPath: z.string().trim().min(1).max(4_000).optional(),
        areaPath: z.string().trim().min(1).max(4_000).optional(),
        tags: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
        fields: fieldsSchema,
        validateOnly: z.boolean().optional().describe("Validate without saving the work item."),
        suppressNotifications: z.boolean().optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, workItemType, title, description, assignedTo, iterationPath, areaPath, tags, fields, validateOnly, suppressNotifications, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject }, async () => ({
        workItem: await createWorkItem(client, resolvedProject, workItemType, {
          title,
          ...(description !== undefined ? { description } : {}),
          ...(assignedTo ? { assignedTo } : {}),
          ...(iterationPath ? { iterationPath } : {}),
          ...(areaPath ? { areaPath } : {}),
          ...(tags ? { tags } : {}),
          ...(fields ? { fields } : {}),
          ...(validateOnly !== undefined ? { validateOnly } : {}),
          ...(suppressNotifications !== undefined ? { suppressNotifications } : {})
        })
      }));
    }
  );

  server.registerTool(
    "update_work_item",
    {
      title: "Update work item",
      description: "Update state, assignee, tags, sprint, area, or custom fields on an Azure Boards item. Optional revision check prevents stale writes.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        state: z.string().trim().min(1).max(256).optional(),
        assignedTo: z.string().trim().min(1).max(512).optional(),
        tags: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
        iterationPath: z.string().trim().min(1).max(4_000).optional().describe("Set this to move the item to a sprint."),
        areaPath: z.string().trim().min(1).max(4_000).optional(),
        fields: fieldsSchema,
        removeFields: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
        expectedRevision: z.number().int().positive().optional().describe("Fail if the work item revision changed."),
        validateOnly: z.boolean().optional(),
        suppressNotifications: z.boolean().optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, workItemId, state, assignedTo, tags, iterationPath, areaPath, fields, removeFields, expectedRevision, validateOnly, suppressNotifications, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      const mergedFields: Record<string, unknown> = {
        ...(fields ?? {}),
        ...(state ? { "System.State": state } : {}),
        ...(assignedTo ? { "System.AssignedTo": assignedTo } : {}),
        ...(tags ? { "System.Tags": [...new Set(tags)].join("; ") } : {}),
        ...(iterationPath ? { "System.IterationPath": iterationPath } : {}),
        ...(areaPath ? { "System.AreaPath": areaPath } : {})
      };
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId }, async () => ({
        workItem: await updateWorkItem(client, resolvedProject, workItemId, {
          ...(Object.keys(mergedFields).length ? { fields: mergedFields } : {}),
          ...(removeFields ? { removeFields } : {}),
          ...(expectedRevision !== undefined ? { expectedRevision } : {}),
          ...(validateOnly !== undefined ? { validateOnly } : {}),
          ...(suppressNotifications !== undefined ? { suppressNotifications } : {})
        })
      }));
    }
  );

  server.registerTool(
    "add_work_item_relation",
    {
      title: "Add work item relation",
      description: "Link two work items as parent, child, related, dependency, or duplicate. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        targetWorkItemId: workItemIdSchema,
        relation: z.enum(["parent", "child", "related", "predecessor", "successor", "duplicate", "duplicateOf"]),
        comment: z.string().trim().min(1).max(4_000).optional(),
        expectedRevision: z.number().int().positive().optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, workItemId, targetWorkItemId, relation, comment, expectedRevision, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId, targetWorkItemId }, async () => ({
        workItem: await addWorkItemRelation(client, resolvedProject, workItemId, targetWorkItemId, relation, {
          ...(comment ? { comment } : {}),
          ...(expectedRevision !== undefined ? { expectedRevision } : {})
        })
      }));
    }
  );

  server.registerTool(
    "add_work_item_attachment",
    {
      title: "Add work item attachment",
      description: "Upload a base64 file up to 10 MiB and attach it to a work item. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        fileName: z.string().trim().min(1).max(256),
        contentBase64: z.string().min(1).max(14_000_000),
        comment: z.string().trim().min(1).max(4_000).optional(),
        expectedRevision: z.number().int().positive().optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, workItemId, fileName, contentBase64, comment, expectedRevision, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId }, async () =>
        addWorkItemAttachment(client, resolvedProject, workItemId, {
          fileName,
          contentBase64,
          ...(comment ? { comment } : {}),
          ...(expectedRevision !== undefined ? { expectedRevision } : {})
        })
      );
    }
  );
}
