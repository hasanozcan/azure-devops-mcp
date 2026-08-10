import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import {
  getPipelineRun,
  getPipelineRunLogs,
  listBuilds,
  listPipelineRuns,
  listPipelines,
  rerunPipeline,
  runPipeline
} from "../azureDevOps/pipelines.js";
import { authorizeMutation, resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional();
const pipelineIdSchema = z.number().int().positive();
const runIdSchema = z.number().int().positive();
const confirmSchema = z.boolean().describe("Must be true to queue a pipeline run.");

export function registerPipelineTools(server: McpServer, client: AzureDevOpsClient): void {
  server.registerTool(
    "list_pipelines",
    {
      title: "List pipelines",
      description: "List Azure Pipelines definitions in a project.",
      inputSchema: {
        project: projectSchema,
        top: z.number().int().positive().max(1_000).optional(),
        continuationToken: z.string().trim().min(1).optional(),
        orderBy: z.string().trim().min(1).max(256).optional()
      }
    },
    async ({ project, top, continuationToken, orderBy }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject }, async () => {
        const page = await listPipelines(client, resolvedProject, {
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {}),
          ...(orderBy ? { orderBy } : {})
        });
        return { pipelines: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "list_pipeline_runs",
    {
      title: "List pipeline runs",
      description: "List runs for one Azure Pipeline.",
      inputSchema: { project: projectSchema, pipelineId: pipelineIdSchema, top: z.number().int().positive().max(1_000).optional(), continuationToken: z.string().trim().min(1).optional() }
    },
    async ({ project, pipelineId, top, continuationToken }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, pipelineId }, async () => {
        const page = await listPipelineRuns(client, resolvedProject, pipelineId, {
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {})
        });
        return { runs: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );

  server.registerTool(
    "get_pipeline_run",
    {
      title: "Get pipeline run",
      description: "Get one Azure Pipeline run and its current state/result.",
      inputSchema: { project: projectSchema, pipelineId: pipelineIdSchema, runId: runIdSchema }
    },
    async ({ project, pipelineId, runId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, pipelineId, runId }, async () => ({
        run: await getPipelineRun(client, resolvedProject, pipelineId, runId)
      }));
    }
  );

  server.registerTool(
    "run_pipeline",
    {
      title: "Run pipeline",
      description: "Queue or preview an Azure Pipeline run with optional branch, variables, parameters, and skipped stages.",
      inputSchema: {
        project: projectSchema,
        pipelineId: pipelineIdSchema,
        branch: z.string().trim().min(1).max(512).optional(),
        variables: z.record(z.string().trim().min(1).max(256), z.string().max(10_000)).optional(),
        templateParameters: z.record(z.string().trim().min(1).max(256), z.unknown()).optional(),
        stagesToSkip: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
        previewRun: z.boolean().optional(),
        confirm: confirmSchema
      }
    },
    async ({ project, pipelineId, branch, variables, templateParameters, stagesToSkip, previewRun, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, pipelineId }, async () => ({
        run: await runPipeline(client, resolvedProject, pipelineId, {
          ...(branch ? { branch } : {}),
          ...(variables ? { variables } : {}),
          ...(templateParameters ? { templateParameters } : {}),
          ...(stagesToSkip ? { stagesToSkip } : {}),
          ...(previewRun !== undefined ? { previewRun } : {})
        })
      }));
    }
  );

  server.registerTool(
    "rerun_pipeline",
    {
      title: "Rerun pipeline",
      description: "Queue a full rerun using the resolved resources of a previous run. Azure REST does not expose failed-job-only rerun here.",
      inputSchema: { project: projectSchema, pipelineId: pipelineIdSchema, runId: runIdSchema, confirm: confirmSchema }
    },
    async ({ project, pipelineId, runId, confirm }) => {
      authorizeMutation(client, confirm);
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, pipelineId, runId }, async () => ({
        ...(await rerunPipeline(client, resolvedProject, pipelineId, runId)),
        rerunScope: "full"
      }));
    }
  );

  server.registerTool(
    "get_pipeline_run_logs",
    {
      title: "Get pipeline run logs",
      description: "List log records for a pipeline run or fetch one bounded plain-text log.",
      inputSchema: {
        project: projectSchema,
        runId: runIdSchema,
        logId: z.number().int().nonnegative().optional(),
        maxChars: z.number().int().positive().max(1_000_000).optional()
      }
    },
    async ({ project, runId, logId, maxChars }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, runId }, async () => ({
        ...(await getPipelineRunLogs(client, resolvedProject, runId, {
          ...(logId !== undefined ? { logId } : {}),
          ...(maxChars !== undefined ? { maxChars } : {})
        }))
      }));
    }
  );

  server.registerTool(
    "list_builds",
    {
      title: "List builds",
      description: "List and filter Azure Pipeline build records for status, result, repository, definition, or branch.",
      inputSchema: {
        project: projectSchema,
        definitionIds: z.array(z.number().int().positive()).max(100).optional(),
        repositoryId: z.string().trim().min(1).optional(),
        branch: z.string().trim().min(1).max(512).optional(),
        statusFilter: z.enum(["none", "inProgress", "completed", "cancelling", "postponed", "notStarted", "all"]).optional(),
        resultFilter: z.enum(["none", "succeeded", "partiallySucceeded", "failed", "canceled"]).optional(),
        top: z.number().int().positive().max(1_000).optional(),
        continuationToken: z.string().trim().min(1).optional()
      }
    },
    async ({ project, definitionIds, repositoryId, branch, statusFilter, resultFilter, top, continuationToken }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject }, async () => {
        const page = await listBuilds(client, resolvedProject, {
          ...(definitionIds ? { definitionIds } : {}),
          ...(repositoryId ? { repositoryId } : {}),
          ...(branch ? { branch } : {}),
          ...(statusFilter ? { statusFilter } : {}),
          ...(resultFilter ? { resultFilter } : {}),
          ...(top !== undefined ? { top } : {}),
          ...(continuationToken ? { continuationToken } : {})
        });
        return { builds: page.items, pagination: { count: page.count, continuationToken: page.continuationToken ?? null } };
      });
    }
  );
}
