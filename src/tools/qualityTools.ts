import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import {
  getBatchPullRequestReviewSummary,
  getPullRequestMergeReadiness,
  getStaleRepositoryReport,
  getWorkItemAuditHistory,
  getWorkItemDeliveryTrace
} from "../azureDevOps/quality.js";
import { resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional();
const repositorySchema = z.string().trim().min(1);
const pullRequestIdSchema = z.number().int().positive();
const workItemIdSchema = z.number().int().positive();

export function registerQualityTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "get_pull_request_merge_readiness",
    {
      title: "Get pull request merge readiness",
      description: "Evaluate draft/status, mergeability, votes, unresolved threads, policies, and PR status checks without merging.",
      inputSchema: { project: projectSchema, repositoryId: repositorySchema, pullRequestId: pullRequestIdSchema }
    },
    async ({ project, repositoryId, pullRequestId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        readiness: await getPullRequestMergeReadiness(client, resolvedProject, repositoryId, pullRequestId)
      }));
    }
  );

  server.registerTool(
    "get_batch_pull_request_review_summary",
    {
      title: "Get batch pull request review summary",
      description: "Summarize votes and unresolved threads across up to 50 pull requests.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema.optional(),
        status: z.enum(["active", "abandoned", "completed", "all"]).optional(),
        top: z.number().int().positive().max(50).optional()
      }
    },
    async ({ project, repositoryId, status, top }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId: repositoryId ?? null }, async () => ({
        summaries: await getBatchPullRequestReviewSummary(client, resolvedProject, repositoryId, {
          ...(status ? { status } : {}),
          ...(top !== undefined ? { top } : {})
        })
      }));
    }
  );

  server.registerTool(
    "get_stale_repository_report",
    {
      title: "Get stale repository report",
      description: "Report old branches and open pull requests using a shared age threshold.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        staleDays: z.number().int().positive().max(3_650).optional(),
        top: z.number().int().positive().max(500).optional(),
        protectedBranches: z.array(z.string().trim().min(1).max(512)).max(100).optional()
      }
    },
    async ({ project, repositoryId, staleDays, top, protectedBranches }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId }, async () => ({
        report: await getStaleRepositoryReport(client, resolvedProject, repositoryId, {
          ...(staleDays !== undefined ? { staleDays } : {}),
          ...(top !== undefined ? { top } : {}),
          ...(protectedBranches ? { protectedBranches } : {})
        })
      }));
    }
  );

  server.registerTool(
    "get_work_item_delivery_trace",
    {
      title: "Get work item delivery trace",
      description: "Trace a work item to linked pull requests, commits, builds, branches, and related work items.",
      inputSchema: { project: projectSchema, workItemId: workItemIdSchema }
    },
    async ({ project, workItemId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId }, async () => ({
        trace: await getWorkItemDeliveryTrace(client, resolvedProject, workItemId)
      }));
    }
  );

  server.registerTool(
    "get_work_item_audit_history",
    {
      title: "Get work item audit history",
      description: "List revision updates and field/relation changes for a work item.",
      inputSchema: {
        project: projectSchema,
        workItemId: workItemIdSchema,
        top: z.number().int().positive().max(1_000).optional(),
        skip: z.number().int().nonnegative().optional()
      }
    },
    async ({ project, workItemId, top, skip }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, workItemId }, async () => {
        const page = await getWorkItemAuditHistory(client, resolvedProject, workItemId, {
          ...(top !== undefined ? { top } : {}),
          ...(skip !== undefined ? { skip } : {})
        });
        return { updates: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );
}
