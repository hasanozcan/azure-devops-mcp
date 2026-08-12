import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import {
  addWorkItemComment,
  completePullRequest,
  createPullRequest,
  createPullRequestComment,
  createPullRequestInlineComment,
  deletePullRequestComment,
  deleteWorkItemComment,
  replyToPullRequestThread,
  setPullRequestVote,
  updatePullRequestComment,
  updateWorkItemComment,
  updatePullRequestThreadStatus
} from "../azureDevOps/mutations.js";
import { PullRequestDiffService } from "../review/diffEngine.js";
import { validateInlineCommentTarget } from "../review/inlineTargetValidator.js";
import { authorizeMutation, resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional().describe("Project name or ID. Omit to use AZURE_DEVOPS_DEFAULT_PROJECT.");
const repositorySchema = z.string().trim().min(1).describe("Repository name or ID.");
const pullRequestIdSchema = z.number().int().positive().describe("Pull request numeric ID.");
const workItemIdSchema = z.number().int().positive().describe("Work item numeric ID.");
const branchSchema = z.string().trim().min(1).max(512).describe("Branch name or refs/heads/... ref.");
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
    "update_work_item_comment",
    {
      title: "Update work item comment",
      description: "Replace the text of an Azure Boards work item comment. Azure DevOps author and permission rules apply. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        commentId: z.number().int().positive().describe("Work item comment ID."),
        text: workItemCommentTextSchema,
        confirm: confirmSchema
      }
    },
    async ({ project, workItemId, commentId, text, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId, commentId }, async () => ({
        comment: await updateWorkItemComment(client, resolvedProject, workItemId, commentId, text)
      }));
    }
  );

  server.registerTool(
    "delete_work_item_comment",
    {
      title: "Delete work item comment",
      description: "Soft-delete an Azure Boards work item comment. Azure DevOps author and permission rules apply. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        commentId: z.number().int().positive().describe("Exact work item comment ID to delete."),
        confirm: confirmSchema
      }
    },
    async ({ project, workItemId, commentId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId, commentId }, async () => ({
        deleted: true,
        comment: await deleteWorkItemComment(client, resolvedProject, workItemId, commentId)
      }));
    }
  );

  server.registerTool(
    "create_pull_request",
    {
      title: "Create pull request",
      description: "Create a same-repository Azure Repos pull request. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        sourceBranch: branchSchema.describe("Source branch name or refs/heads/... ref."),
        targetBranch: branchSchema.describe("Target branch name or refs/heads/... ref."),
        title: z.string().trim().min(1).max(400),
        description: z.string().trim().max(4_000).optional(),
        isDraft: z.boolean().optional(),
        reviewerIds: z.array(z.string().trim().min(1)).max(100).optional().describe("Optional Azure DevOps identity IDs."),
        workItemIds: z.array(z.number().int().positive()).max(200).optional().describe("Optional work items to link."),
        supportsIterations: z.boolean().optional().describe("Track subsequent source-branch pushes as reviewable iterations."),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, sourceBranch, targetBranch, title, description, isDraft, reviewerIds, workItemIds, supportsIterations, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId }, async () => ({
        pullRequest: await createPullRequest(client, resolvedProject, repositoryId, {
          sourceBranch,
          targetBranch,
          title,
          ...(description !== undefined ? { description } : {}),
          ...(isDraft !== undefined ? { isDraft } : {}),
          ...(reviewerIds ? { reviewerIds } : {}),
          ...(workItemIds ? { workItemIds } : {}),
          ...(supportsIterations !== undefined ? { supportsIterations } : {})
        })
      }));
    }
  );

  server.registerTool(
    "complete_pull_request",
    {
      title: "Complete pull request",
      description: "Merge an active, non-draft PR without bypassing policies. Requires the reviewed source commit, write tools, and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        expectedSourceCommitId: z.string().trim().regex(/^[0-9a-f]{40}$/i).describe("Exact source commit SHA reviewed and approved for merge."),
        mergeStrategy: z.enum(["noFastForward", "squash", "rebase", "rebaseMerge"]),
        deleteSourceBranch: z.boolean().optional().describe("Delete the source branch after completion; defaults to false."),
        transitionWorkItems: z.boolean().optional().describe("Move linked work items to their next logical state; defaults to false."),
        mergeCommitMessage: z.string().trim().min(1).max(4_000).optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, expectedSourceCommitId, mergeStrategy, deleteSourceBranch, transitionWorkItems, mergeCommitMessage, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const pullRequest = await completePullRequest(client, resolvedProject, repositoryId, pullRequestId, {
          expectedSourceCommitId,
          mergeStrategy,
          ...(deleteSourceBranch !== undefined ? { deleteSourceBranch } : {}),
          ...(transitionWorkItems !== undefined ? { transitionWorkItems } : {}),
          ...(mergeCommitMessage !== undefined ? { mergeCommitMessage } : {})
        });
        return {
          pullRequest,
          completedSourceCommitId: expectedSourceCommitId,
          policyBypass: false
        };
      });
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
    "update_pull_request_comment",
    {
      title: "Update pull request comment",
      description: "Replace a top-level or reply comment inside a pull request thread. Azure DevOps author and permission rules apply. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        threadId: z.number().int().positive(),
        commentId: z.number().int().positive().describe("Comment ID inside the thread."),
        content: contentSchema,
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, threadId, commentId, content, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId, threadId, commentId }, async () => ({
        comment: await updatePullRequestComment(client, resolvedProject, repositoryId, pullRequestId, threadId, commentId, content)
      }));
    }
  );

  server.registerTool(
    "delete_pull_request_comment",
    {
      title: "Delete pull request comment",
      description: "Soft-delete a top-level or reply comment inside a pull request thread. Azure DevOps author and permission rules apply. Requires write tools and confirm=true.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        threadId: z.number().int().positive(),
        commentId: z.number().int().positive().describe("Exact comment ID inside the thread to delete."),
        confirm: confirmSchema
      }
    },
    async ({ project, repositoryId, pullRequestId, threadId, commentId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId, threadId, commentId }, async () => {
        await deletePullRequestComment(client, resolvedProject, repositoryId, pullRequestId, threadId, commentId);
        return { deleted: true };
      });
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
