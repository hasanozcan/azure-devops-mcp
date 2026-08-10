import { describe, expect, it, vi } from "vitest";

import { compareBranches, createBranch, deleteBranch } from "../src/azureDevOps/branchLifecycle.js";
import type { FetchLike } from "../src/azureDevOps/client.js";
import { runPipeline, getPipelineRunLogs } from "../src/azureDevOps/pipelines.js";
import { setPullRequestAutoComplete } from "../src/azureDevOps/prLifecycle.js";
import { getPullRequestMergeReadiness } from "../src/azureDevOps/quality.js";
import { getIterationVelocity } from "../src/azureDevOps/sprints.js";
import { addWorkItemAttachment, createWorkItem, updateWorkItem } from "../src/azureDevOps/workItemMutations.js";
import { jsonResponse, makeClient } from "./helpers.js";

describe("extended Azure DevOps capabilities", () => {
  it("uses JSON Patch content type for work item creation and updates", async () => {
    const calls: Array<{ method?: string; contentType: string | null; body: unknown }> = [];
    const fetch: FetchLike = async (_input, init) => {
      calls.push({
        method: init?.method,
        contentType: new Headers(init?.headers).get("content-type"),
        body: JSON.parse(String(init?.body))
      });
      return jsonResponse({ id: 544, rev: calls.length });
    };
    const client = makeClient(fetch, { writeToolsEnabled: true });

    await createWorkItem(client, "Project One", "User Story", {
      title: "Deliver MCP capabilities",
      tags: ["mcp", "azure", "mcp"],
      iterationPath: "Project One\\Sprint 1"
    });
    await updateWorkItem(client, "Project One", 544, {
      expectedRevision: 1,
      fields: { "System.State": "Active" }
    });

    expect(calls[0]).toMatchObject({ method: "POST", contentType: "application/json-patch+json" });
    expect(calls[0]?.body).toContainEqual({ op: "add", path: "/fields/System.Tags", value: "mcp; azure" });
    expect(calls[1]).toMatchObject({ method: "PATCH", contentType: "application/json-patch+json" });
    expect(calls[1]?.body).toEqual([
      { op: "test", path: "/rev", value: 1 },
      { op: "add", path: "/fields/System.State", value: "Active" }
    ]);
  });

  it("uploads binary data then adds the attachment relation", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fetch: FetchLike = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.pathname.endsWith("/_apis/wit/attachments")) return jsonResponse({ id: "attachment-1", url: "https://example/attachment-1" });
      return jsonResponse({ id: 544, rev: 2 });
    };
    const client = makeClient(fetch, { writeToolsEnabled: true });

    const result = await addWorkItemAttachment(client, "Project One", 544, {
      fileName: "note.txt",
      contentBase64: Buffer.from("hello").toString("base64"),
      expectedRevision: 1
    });

    expect(result.attachment.id).toBe("attachment-1");
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/octet-stream");
    expect(JSON.parse(String(calls[1]?.init?.body))).toContainEqual({
      op: "add",
      path: "/relations/-",
      value: { rel: "AttachedFile", url: "https://example/attachment-1", attributes: { name: "note.txt" } }
    });
  });

  it("creates and deletes refs with optimistic object IDs", async () => {
    const bodies: unknown[] = [];
    const fetch: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      const request = bodies.at(-1) as Array<{ name: string; oldObjectId: string; newObjectId: string }>;
      return jsonResponse([{ ...request[0], success: true }]);
    };
    const client = makeClient(fetch, { writeToolsEnabled: true });
    const sha = "a".repeat(40);

    await createBranch(client, "Project One", "repo", "feature/544", sha);
    await deleteBranch(client, "Project One", "repo", "feature/544", sha);

    expect(bodies[0]).toEqual([{ name: "refs/heads/feature/544", oldObjectId: "0".repeat(40), newObjectId: sha }]);
    expect(bodies[1]).toEqual([{ name: "refs/heads/feature/544", oldObjectId: sha, newObjectId: "0".repeat(40) }]);
  });

  it("compares branches using branch-version parameters", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("baseVersion")).toBe("develop");
      expect(url.searchParams.get("targetVersion")).toBe("feature/544");
      return jsonResponse({ aheadCount: 3, behindCount: 1, changes: [] });
    });
    const result = await compareBranches(makeClient(fetch), "Project One", "repo", "develop", "feature/544");
    expect(result).toMatchObject({ aheadCount: 3, behindCount: 1 });
  });

  it("enables auto-complete as the current user without policy bypass", async () => {
    const bodies: unknown[] = [];
    const fetch: FetchLike = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/_apis/connectionData")) return jsonResponse({ authenticatedUser: { id: "user-1" } });
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ pullRequestId: 7, status: "active", title: "PR", sourceRefName: "refs/heads/a", targetRefName: "refs/heads/b", repository: { id: "repo", name: "repo" } });
    };
    const client = makeClient(fetch, { writeToolsEnabled: true });

    await setPullRequestAutoComplete(client, "Project One", "repo", 7, { enabled: true, mergeStrategy: "squash" });

    expect(bodies[0]).toEqual({
      autoCompleteSetBy: { id: "user-1" },
      completionOptions: {
        mergeStrategy: "squash",
        deleteSourceBranch: false,
        transitionWorkItems: false,
        bypassPolicy: false
      }
    });
  });

  it("queues pipelines with normalized branch and bounded variables", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => jsonResponse({ id: 12, state: "inProgress", request: JSON.parse(String(init?.body)) }));
    const result = await runPipeline(makeClient(fetch, { writeToolsEnabled: true }), "Project One", 4, {
      branch: "feature/544",
      variables: { mode: "safe" },
      templateParameters: { deploy: false }
    });
    expect((result as { request?: unknown }).request).toEqual({
      resources: { repositories: { self: { refName: "refs/heads/feature/544" } } },
      variables: { mode: { value: "safe" } },
      templateParameters: { deploy: false }
    });
  });

  it("lists build logs or truncates one log body", async () => {
    const fetch: FetchLike = async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith("/logs") ? jsonResponse({ count: 1, value: [{ id: 2, lineCount: 4 }] }) : new Response("0123456789");
    };
    const client = makeClient(fetch);

    await expect(getPipelineRunLogs(client, "Project One", 8)).resolves.toEqual({ logs: [{ id: 2, lineCount: 4 }] });
    await expect(getPipelineRunLogs(client, "Project One", 8, { logId: 2, maxChars: 5 })).resolves.toEqual({ logId: 2, text: "01234", truncated: true });
  });

  it("computes iteration velocity from configured point fields and completed states", async () => {
    const fetch: FetchLike = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/teamsettings/iterations/") && url.pathname.endsWith("/workitems")) {
        return jsonResponse({ workItemRelations: [{ target: { id: 1 } }, { target: { id: 2 } }] });
      }
      return jsonResponse({
        count: 2,
        value: [
          { id: 1, fields: { "System.State": "Done", "Microsoft.VSTS.Scheduling.StoryPoints": 5 } },
          { id: 2, fields: { "System.State": "Active", "Microsoft.VSTS.Scheduling.StoryPoints": 3 } }
        ]
      });
    };
    const velocity = await getIterationVelocity(makeClient(fetch), "Project One", "Team A", "iteration-1");
    expect(velocity).toMatchObject({ totalItems: 2, completedItems: 1, totalPoints: 8, completedPoints: 5, completionPercent: 62.5 });
  });

  it("reports merge blockers from votes, threads, policies, and statuses", async () => {
    const fetch: FetchLike = async (input) => {
      const url = new URL(String(input));
      const path = url.pathname;
      if (path.includes("/_apis/projects/")) return jsonResponse({ id: "project-id", name: "Project One" });
      if (path.endsWith("/reviewers")) return jsonResponse({ count: 1, value: [{ id: "r1", vote: -5, isRequired: true }] });
      if (path.endsWith("/threads")) return jsonResponse({ count: 1, value: [{ id: 1, status: "active" }] });
      if (path.endsWith("/evaluations")) {
        expect(url.searchParams.get("artifactId")).toBe("vstfs:///CodeReview/CodeReviewId/project-id/7");
        return jsonResponse({ count: 1, value: [{ status: "running" }] });
      }
      if (path.endsWith("/statuses")) return jsonResponse({ count: 1, value: [{ state: "failed", context: { name: "build" } }] });
      return jsonResponse({
        pullRequestId: 7,
        status: "active",
        title: "PR",
        isDraft: false,
        mergeStatus: "succeeded",
        sourceRefName: "refs/heads/a",
        targetRefName: "refs/heads/b",
        repository: { id: "repo", name: "repo" }
      });
    };
    const readiness = await getPullRequestMergeReadiness(makeClient(fetch), "Project One", "repo", 7);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      "1 reviewer vote(s) block completion",
      "1 active or pending thread(s)",
      "1 policy evaluation(s) are not approved",
      "1 PR status check(s) are pending or failed"
    ]));
  });
});
