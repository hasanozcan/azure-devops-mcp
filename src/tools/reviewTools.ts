import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { AzureDevOpsClient } from "../azureDevOps/client.js";
import { buildUnifiedDiff, PullRequestDiffService } from "../review/diffEngine.js";
import { validateInlineCommentTarget } from "../review/inlineTargetValidator.js";
import { getPullRequestReviewContext } from "../review/reviewContext.js";
import { resolveProject, runReadTool } from "./helpers.js";

const projectSchema = z.string().trim().min(1).optional().describe("Project name or ID. Omit to use AZURE_DEVOPS_DEFAULT_PROJECT.");
const repositorySchema = z.string().trim().min(1).describe("Repository name or ID.");
const pullRequestIdSchema = z.number().int().positive().describe("Pull request numeric ID.");

export function registerReviewTools(server: McpServer, client: AzureDevOpsClient, diffService: PullRequestDiffService): void {
  server.registerTool(
    "get_pull_request_changed_files",
    {
      title: "Get pull request changed files",
      description: "Return changed files and locally computed line statistics for a pull request iteration.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        iterationId: z.number().int().positive().optional(),
        maxFiles: z.number().int().positive().max(500).optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, iterationId, maxFiles }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const bundle = await diffService.getBundle(resolvedProject, repositoryId, pullRequestId, {
          ...(iterationId !== undefined ? { iterationId } : {}),
          ...(maxFiles !== undefined ? { maxFiles } : {})
        });
        return {
          iterationId: bundle.iterationId,
          baseCommitId: bundle.baseCommitId,
          sourceCommitId: bundle.sourceCommitId,
          changedFiles: bundle.files.map(({ patch: _patch, ...file }) => file),
          pagination: {
            totalFiles: bundle.totalFiles,
            processedFiles: bundle.processedFiles,
            truncated: bundle.truncated
          }
        };
      });
    }
  );

  server.registerTool(
    "get_pull_request_diff_stats",
    {
      title: "Get pull request diff statistics",
      description: "Return aggregate additions, deletions, file counts, and largest changed files.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        iterationId: z.number().int().positive().optional(),
        maxFiles: z.number().int().positive().max(500).optional(),
        largestFilesLimit: z.number().int().positive().max(100).optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, iterationId, maxFiles, largestFilesLimit = 20 }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const bundle = await diffService.getBundle(resolvedProject, repositoryId, pullRequestId, {
          ...(iterationId !== undefined ? { iterationId } : {}),
          ...(maxFiles !== undefined ? { maxFiles } : {})
        });
        const largestFiles = bundle.files
          .map(({ patch: _patch, ...file }) => file)
          .sort((left, right) => right.additions + right.deletions - (left.additions + left.deletions))
          .slice(0, largestFilesLimit);
        return {
          stats: {
            iterationId: bundle.iterationId,
            baseCommitId: bundle.baseCommitId,
            sourceCommitId: bundle.sourceCommitId,
            totalFiles: bundle.totalFiles,
            processedFiles: bundle.processedFiles,
            additions: bundle.additions,
            deletions: bundle.deletions,
            binaryFiles: bundle.binaryFiles,
            oversizedFiles: bundle.oversizedFiles,
            truncated: bundle.truncated,
            largestFiles
          }
        };
      });
    }
  );

  server.registerTool(
    "get_pull_request_diff",
    {
      title: "Get pull request diff",
      description: "Build and return a unified diff for an Azure Repos pull request.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        iterationId: z.number().int().positive().optional(),
        maxFiles: z.number().int().positive().max(500).optional(),
        startLine: z.number().int().positive().optional(),
        maxLines: z.number().int().positive().max(10_000).optional(),
        contextLines: z.number().int().nonnegative().max(100).optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, iterationId, maxFiles, startLine, maxLines, contextLines }) => {
      const resolvedProject = resolveProject(client, project);
      const resolvedMaxLines = Math.min(maxLines ?? 1_000, client.maxDiffLines);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => {
        const bundle = await diffService.getBundle(resolvedProject, repositoryId, pullRequestId, {
          ...(iterationId !== undefined ? { iterationId } : {}),
          ...(maxFiles !== undefined ? { maxFiles } : {}),
          ...(contextLines !== undefined ? { contextLines } : {})
        });
        return {
          iterationId: bundle.iterationId,
          baseCommitId: bundle.baseCommitId,
          sourceCommitId: bundle.sourceCommitId,
          diff: buildUnifiedDiff(bundle, {
            ...(startLine !== undefined ? { startLine } : {}),
            maxLines: resolvedMaxLines
          }),
          fileSummary: {
            totalFiles: bundle.totalFiles,
            processedFiles: bundle.processedFiles,
            additions: bundle.additions,
            deletions: bundle.deletions,
            binaryFiles: bundle.binaryFiles,
            oversizedFiles: bundle.oversizedFiles,
            truncated: bundle.truncated
          }
        };
      });
    }
  );

  server.registerTool(
    "get_pull_request_file_diff",
    {
      title: "Get pull request file diff",
      description: "Return the locally generated unified diff for one file in a pull request.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        path: z.string().trim().min(1),
        iterationId: z.number().int().positive().optional(),
        startLine: z.number().int().positive().optional(),
        maxLines: z.number().int().positive().max(10_000).optional(),
        contextLines: z.number().int().nonnegative().max(100).optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, path, iterationId, startLine, maxLines, contextLines }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId, path }, async () => {
        const result = await diffService.getFileDiff(resolvedProject, repositoryId, pullRequestId, path, {
          ...(iterationId !== undefined ? { iterationId } : {}),
          ...(contextLines !== undefined ? { contextLines } : {})
        });
        return {
          iterationId: result.context.iterationId,
          file: {
            ...result.file,
            patch: sliceText(result.file.patch, startLine ?? 1, Math.min(maxLines ?? 1_000, client.maxDiffLines))
          }
        };
      });
    }
  );

  server.registerTool(
    "validate_inline_comment_target",
    {
      title: "Validate inline comment target",
      description: "Dry-run an inline comment path and line range against the current pull request iteration.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        path: z.string().trim().min(1),
        fromLine: z.number().int().positive().optional().describe("Original-side ending line."),
        toLine: z.number().int().positive().optional().describe("New-side ending line."),
        startFromLine: z.number().int().positive().optional(),
        startToLine: z.number().int().positive().optional(),
        iterationId: z.number().int().positive().optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, path, fromLine, toLine, startFromLine, startToLine, iterationId }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        validation: await validateInlineCommentTarget(client, diffService, resolvedProject, repositoryId, pullRequestId, {
          path,
          ...(fromLine !== undefined ? { fromLine } : {}),
          ...(toLine !== undefined ? { toLine } : {}),
          ...(startFromLine !== undefined ? { startFromLine } : {}),
          ...(startToLine !== undefined ? { startToLine } : {}),
          ...(iterationId !== undefined ? { iterationId } : {})
        })
      }));
    }
  );

  server.registerTool(
    "get_pull_request_review_context",
    {
      title: "Get pull request review context",
      description: "Return PR metadata, diff summary, unified diff, commits, threads, reviewers, and linked work items in one review bundle.",
      inputSchema: {
        project: projectSchema,
        repositoryId: repositorySchema,
        pullRequestId: pullRequestIdSchema,
        diffMaxLines: z.number().int().positive().max(10_000).optional(),
        maxFiles: z.number().int().positive().max(500).optional(),
        includeCommits: z.boolean().optional(),
        includeThreads: z.boolean().optional(),
        includeReviewers: z.boolean().optional(),
        includeWorkItems: z.boolean().optional()
      }
    },
    async ({ project, repositoryId, pullRequestId, diffMaxLines, maxFiles, includeCommits, includeThreads, includeReviewers, includeWorkItems }) => {
      const resolvedProject = resolveProject(client, project);
      return runReadTool({ organization: client.organization, project: resolvedProject, repositoryId, pullRequestId }, async () => ({
        reviewContext: await getPullRequestReviewContext(client, diffService, resolvedProject, repositoryId, pullRequestId, {
          ...(diffMaxLines !== undefined ? { diffMaxLines: Math.min(diffMaxLines, client.maxDiffLines) } : {}),
          ...(maxFiles !== undefined ? { maxFiles } : {}),
          ...(includeCommits !== undefined ? { includeCommits } : {}),
          ...(includeThreads !== undefined ? { includeThreads } : {}),
          ...(includeReviewers !== undefined ? { includeReviewers } : {}),
          ...(includeWorkItems !== undefined ? { includeWorkItems } : {})
        })
      }));
    }
  );
}

function sliceText(value: string | null, startLine: number, maxLines: number) {
  if (value === null) {
    return { text: null, startLine, endLine: startLine - 1, totalLines: 0, truncated: false };
  }
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const startIndex = Math.min(lines.length, Math.max(0, startLine - 1));
  const selected = lines.slice(startIndex, startIndex + maxLines);
  return {
    text: selected.join("\n"),
    startLine,
    endLine: selected.length === 0 ? startLine - 1 : startLine + selected.length - 1,
    totalLines: lines.length,
    truncated: startIndex > 0 || startIndex + selected.length < lines.length
  };
}
