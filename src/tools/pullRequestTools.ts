import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { getPullRequestCommits, listCommits } from "../azureDevOps/commits.js";
import { listPullRequestIterations } from "../azureDevOps/iterations.js";
import { getPullRequest, getPullRequestByUrl, getPullRequestReviewers, listPullRequests } from "../azureDevOps/pullRequests.js";
import { getPullRequestThreadComments, getPullRequestThreads } from "../azureDevOps/threads.js";
import { getPullRequestWorkItems } from "../azureDevOps/workItems.js";
import { resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional().describe("Project name or ID. Omit to use AZURE_DEVOPS_DEFAULT_PROJECT.");
const repositorySchema = z.string().trim().min(1).describe("Repository name or ID.");
const pullRequestIdSchema = z.number().int().positive().describe("Pull request numeric ID.");

export function registerPullRequestTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "list_pull_requests",
    {
      title: "List pull requests",
      description: "List Azure Repos pull requests in a repository or project.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema.optional().describe("Optional repository name or ID. Omit to search the whole project."),
        status: z.enum(["active", "abandoned", "completed", "all", "notSet"]).optional(),
        sourceRefName: z.string().trim().min(1).optional(),
        targetRefName: z.string().trim().min(1).optional(),
        creatorId: z.string().trim().min(1).optional(),
        reviewerId: z.string().trim().min(1).optional(),
        top: z.number().int().positive().max(1_000).optional(),
        skip: z.number().int().nonnegative().optional()
      }
    },
    async ({ project, repositoryId, status, sourceRefName, targetRefName, creatorId, reviewerId, top, skip }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId: repositoryId ?? null }, async () => {
        const page = await listPullRequests(client, resolvedProject, repositoryId, {
          ...(status ? { status } : {}),
          ...(sourceRefName ? { sourceRefName } : {}),
          ...(targetRefName ? { targetRefName } : {}),
          ...(creatorId ? { creatorId } : {}),
          ...(reviewerId ? { reviewerId } : {}),
          ...(top !== undefined ? { top } : {}),
          ...(skip !== undefined ? { skip } : {})
        });
        return { pullRequests: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "get_pull_request",
    {
      title: "Get pull request",
      description: "Get one Azure Repos pull request with commits and linked work item references.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema
      }
    },
    async ({ project, repositoryId, pullRequestId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        pullRequest: await getPullRequest(client, resolvedProject, repositoryId, pullRequestId)
      }));
    }
  );

  server.registerTool(
    "get_pull_request_by_url",
    {
      title: "Get pull request by URL",
      description: "Parse an Azure DevOps pull request URL and retrieve the pull request.",
      inputSchema: {
        url: z.url().describe("Azure DevOps pull request web URL.")
      }
    },
    async ({ url }) =>
      runReadTool({ organization: client.organization, url }, async () => {
        const result = await getPullRequestByUrl(client, url);
        return { parsed: result.parsed, pullRequest: result.pullRequest };
      })
  );

  server.registerTool(
    "get_pull_request_commits",
    {
      title: "Get pull request commits",
      description: "List commits included in a pull request.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        top: z.number().int().positive().max(2_000).optional(),
        continuationToken: z.string().trim().min(1).optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, top, continuationToken }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const page = await getPullRequestCommits(client, resolvedProject, repositoryId, pullRequestId, {
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {})
        });
        return { commits: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "list_commits",
    {
      title: "List commits",
      description: "List repository commits, optionally scoped to a branch, tag, or commit.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        revision: z.string().trim().min(1).optional(),
        versionType: z.enum(["branch", "tag", "commit"]).optional(),
        top: z.number().int().positive().max(2_000).optional(),
        skip: z.number().int().nonnegative().optional(),
        fromDate: z.string().trim().min(1).optional(),
        toDate: z.string().trim().min(1).optional(),
        author: z.string().trim().min(1).optional()
      }
    },
    async ({ project, repositoryId, revision, versionType, top, skip, fromDate, toDate, author }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId }, async () => {
        const page = await listCommits(client, resolvedProject, repositoryId, {
          ...(revision ? { revision } : {}),
          ...(versionType ? { versionType } : {}),
          ...(top !== undefined ? { top } : {}),
          ...(skip !== undefined ? { skip } : {}),
          ...(fromDate ? { fromDate } : {}),
          ...(toDate ? { toDate } : {}),
          ...(author ? { author } : {})
        });
        return { commits: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "get_pull_request_threads",
    {
      title: "Get pull request threads",
      description: "List top-level and inline comment threads on a pull request.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        iteration: z.number().int().positive().optional(),
        baseIteration: z.number().int().nonnegative().optional(),
        top: z.number().int().positive().max(2_000).optional(),
        continuationToken: z.string().trim().min(1).optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, iteration, baseIteration, top, continuationToken }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const page = await getPullRequestThreads(client, resolvedProject, repositoryId, pullRequestId, {
          ...(iteration !== undefined ? { iteration } : {}),
          ...(baseIteration !== undefined ? { baseIteration } : {}),
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {})
        });
        return { threads: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "get_pull_request_thread_comments",
    {
      title: "Get pull request thread comments",
      description: "List comments inside one pull request thread.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        threadId: z.number().int().positive()
      }
    },
    async ({ project, repositoryId, pullRequestId, threadId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId, threadId }, async () => {
        const page = await getPullRequestThreadComments(client, resolvedProject, repositoryId, pullRequestId, threadId);
        return { comments: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "get_pull_request_work_items",
    {
      title: "Get pull request work items",
      description: "Get work items directly linked to a pull request.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema
      }
    },
    async ({ project, repositoryId, pullRequestId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        ...(await getPullRequestWorkItems(client, resolvedProject, repositoryId, pullRequestId))
      }));
    }
  );

  server.registerTool(
    "get_pull_request_iterations",
    {
      title: "Get pull request iterations",
      description: "List reviewable iterations created by pushes to a pull request.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        includeCommits: z.boolean().optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, includeCommits }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const page = await listPullRequestIterations(client, resolvedProject, repositoryId, pullRequestId, {
          ...(includeCommits !== undefined ? { includeCommits } : {})
        });
        return { iterations: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "get_pull_request_reviewers",
    {
      title: "Get pull request reviewers",
      description: "List pull request reviewers and their current votes.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema
      }
    },
    async ({ project, repositoryId, pullRequestId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        reviewers: await getPullRequestReviewers(client, resolvedProject, repositoryId, pullRequestId)
      }));
    }
  );
}
