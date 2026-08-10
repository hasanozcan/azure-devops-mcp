import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import {
  addWorkItemComment,
  createPullRequestComment,
  createPullRequestInlineComment,
  replyToPullRequestThread,
  setPullRequestVote,
  updatePullRequestThreadStatus
} from "../azureDevOps/mutations.js";
import { PullRequestDiffService } from "../review/diffEngine.js";
import { validateInlineCommentTarget } from "../review/inlineTargetValidator.js";
import { requireConfirmation, requireWriteToolsEnabled, resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional().describe("Project name or ID. Omit to use AZURE_DEVOPS_DEFAULT_PROJECT.");
const repositorySchema = z.string().trim().min(1).describe("Repository name or ID.");
const pullRequestIdSchema = z.number().int().positive().describe("Pull request numeric ID.");
const workItemIdSchema = z.number().int().positive().describe("Work item numeric ID.");
const contentSchema = z.string().trim().min(1).max(150_000).describe("Markdown comment body.");
const workItemCommentTextSchema = z.string().trim().min(1).max(150_000).describe("Work item comment body.");
const confirmSchema = z.boolean().describe("Must be true to perform the mutation.");

export function registerWriteTools(server: McpServer, client: AzureDevOpsClient, diffService: PullRequestDiffService): void {
  server.registerTool(
    "add_work_item_comment",
    {
      title: "Add work item comment",
      description: "Add a Markdown or HTML comment to an Azure Boards work item. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        text: workItemCommentTextSchema,
        format: z.enum(["markdown", "html"]).optional().describe("Comment format; defaults to markdown."),
        confirm: confirmSchema
      }
    },
    async ({ project, workItemId, text, format, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId }, async () => ({
        comment: await addWorkItemComment(client, resolvedProject, workItemId, text, format ?? "markdown")
      }));
    }
  );

  server.registerTool(
    "create_pull_request_comment",
    {
      title: "Create pull request comment",
      description: "Create a top-level pull request comment. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        content: contentSchema,
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, content, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        thread: await createPullRequestComment(client, resolvedProject, repositoryId, pullRequestId, content)
      }));
    }
  );

  server.registerTool(
    "create_pull_request_inline_comment",
    {
      title: "Create pull request inline comment",
      description: "Validate and create a file/line comment on the current pull request iteration. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        content: contentSchema,
        path: z.string().trim().min(1),
        fromLine: z.number().int().positive().optional(),
        toLine: z.number().int().positive().optional(),
        startFromLine: z.number().int().positive().optional(),
        startToLine: z.number().int().positive().optional(),
        iterationId: z.number().int().positive().optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, content, path, fromLine, toLine, startFromLine, startToLine, iterationId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const validation = await validateInlineCommentTarget(client, diffService, resolvedProject, repositoryId, pullRequestId, {
          path,
          ...(fromLine !== undefined ? { fromLine } : {}),
          ...(toLine !== undefined ? { toLine } : {}),
          ...(startFromLine !== undefined ? { startFromLine } : {}),
          ...(startToLine !== undefined ? { startToLine } : {}),
          ...(iterationId !== undefined ? { iterationId } : {})
        });
        if (!validation.valid) {
          throw new Error(validation.message);
        }
        const thread = await createPullRequestInlineComment(client, resolvedProject, repositoryId, pullRequestId, content, validation);
        return { validation, thread };
      });
    }
  );

  server.registerTool(
    "reply_to_pull_request_thread",
    {
      title: "Reply to pull request thread",
      description: "Reply inside an existing pull request comment thread. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        threadId: z.number().int().positive(),
        parentCommentId: z.number().int().positive().optional().describe("Parent comment ID. Defaults to 1."),
        content: contentSchema,
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, threadId, parentCommentId, content, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId, threadId }, async () => ({
        comment: await replyToPullRequestThread(client, resolvedProject, repositoryId, pullRequestId, threadId, content, parentCommentId ?? 1)
      }));
    }
  );

  server.registerTool(
    "update_pull_request_thread_status",
    {
      title: "Update pull request thread status",
      description: "Resolve, reactivate, close, or otherwise update a pull request thread. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        threadId: z.number().int().positive(),
        status: z.enum(["active", "fixed", "wontFix", "closed", "byDesign", "pending"]),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, threadId, status, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId, threadId }, async () => ({
        thread: await updatePullRequestThreadStatus(client, resolvedProject, repositoryId, pullRequestId, threadId, status)
      }));
    }
  );

  server.registerTool(
    "set_pull_request_vote",
    {
      title: "Set pull request vote",
      description: "Set the authenticated user's Azure DevOps pull request vote. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        vote: z.enum(["approve", "approveWithSuggestions", "noVote", "waitForAuthor", "reject"]),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, vote, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        result: await setPullRequestVote(client, resolvedProject, repositoryId, pullRequestId, vote)
      }));
    }
  );

  server.registerTool(
    "request_pull_request_changes",
    {
      title: "Request pull request changes",
      description: "Set the authenticated user's Azure DevOps vote to waitForAuthor (-5). Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        result: await setPullRequestVote(client, resolvedProject, repositoryId, pullRequestId, "waitForAuthor")
      }));
    }
  );
}

function authorizeMutation(client: AzureDevOpsClient, confirm: boolean): void {
  requireConfirmation(confirm);
  requireWriteToolsEnabled(client);
}
