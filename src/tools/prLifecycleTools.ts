import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import {
  addPullRequestLabel,
  addPullRequestReviewer,
  listPullRequestLabels,
  removePullRequestLabel,
  removePullRequestReviewer,
  setPullRequestAutoComplete,
  updatePullRequest
} from "../azureDevOps/prLifecycle.js";
import { authorizeMutation, resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional();
const repositorySchema = z.string().trim().min(1);
const pullRequestIdSchema = z.number().int().positive();
const confirmSchema = z.boolean().describe("Must be true to perform the mutation.");

export function registerPrLifecycleTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "update_pull_request",
    {
      title: "Update pull request",
      description: "Change PR title, description, draft state, or active/abandoned status. Completion is handled by complete_pull_request.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        title: z.string().trim().min(1).max(400).optional(),
        description: z.string().max(4_000).optional(),
        isDraft: z.boolean().optional(),
        status: z.enum(["active", "abandoned"]).optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, title, description, isDraft, status, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        pullRequest: await updatePullRequest(client, resolvedProject, repositoryId, pullRequestId, {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(isDraft !== undefined ? { isDraft } : {}),
          ...(status !== undefined ? { status } : {})
        })
      }));
    }
  );

  server.registerTool(
    "set_pull_request_auto_complete",
    {
      title: "Set pull request auto-complete",
      description: "Enable or disable policy-respecting PR auto-complete. Policy bypass is always false.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        enabled: z.boolean(),
        mergeStrategy: z.enum(["noFastForward", "squash", "rebase", "rebaseMerge"]).optional(),
        deleteSourceBranch: z.boolean().optional(),
        transitionWorkItems: z.boolean().optional(),
        mergeCommitMessage: z.string().trim().min(1).max(4_000).optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, enabled, mergeStrategy, deleteSourceBranch, transitionWorkItems, mergeCommitMessage, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        pullRequest: await setPullRequestAutoComplete(client, resolvedProject, repositoryId, pullRequestId, {
          enabled,
          ...(mergeStrategy ? { mergeStrategy } : {}),
          ...(deleteSourceBranch !== undefined ? { deleteSourceBranch } : {}),
          ...(transitionWorkItems !== undefined ? { transitionWorkItems } : {}),
          ...(mergeCommitMessage ? { mergeCommitMessage } : {})
        }),
        policyBypass: false
      }));
    }
  );

  server.registerTool(
    "manage_pull_request_reviewer",
    {
      title: "Manage pull request reviewer",
      description: "Add or remove a PR reviewer by Azure DevOps identity ID.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        action: z.enum(["add", "remove"]),
        reviewerId: z.string().trim().min(1).max(256),
        isRequired: z.boolean().optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, action, reviewerId, isRequired, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId, reviewerId }, async () => {
        if (action === "remove") {
          await removePullRequestReviewer(client, resolvedProject, repositoryId, pullRequestId, reviewerId);
          return { action, removed: true };
        }
        return { action, reviewer: await addPullRequestReviewer(client, resolvedProject, repositoryId, pullRequestId, reviewerId, isRequired ?? false) };
      });
    }
  );

  server.registerTool(
    "list_pull_request_labels",
    {
      title: "List pull request labels",
      description: "List labels applied to a pull request.",
      inputSchema: { project: projectSchema, repositoryId: repositorySchema, pullRequestId: pullRequestIdSchema }
    },
    async ({ project, repositoryId, pullRequestId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        labels: await listPullRequestLabels(client, resolvedProject, repositoryId, pullRequestId)
      }));
    }
  );

  server.registerTool(
    "manage_pull_request_label",
    {
      title: "Manage pull request label",
      description: "Add or remove a pull request label.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        action: z.enum(["add", "remove"]),
        label: z.string().trim().min(1).max(256).describe("Label name for add, or label ID/name for remove."),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, action, label, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        if (action === "remove") {
          await removePullRequestLabel(client, resolvedProject, repositoryId, pullRequestId, label);
          return { action, label, removed: true };
        }
        return { action, label: await addPullRequestLabel(client, resolvedProject, repositoryId, pullRequestId, label) };
      });
    }
  );
}
