import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/azureDevOps/client.js";
import {
  addWorkItemComment,
  completePullRequest,
  createPullRequest,
  createPullRequestComment,
  createPullRequestInlineComment,
  deletePullRequestComment,
  deleteWorkItemComment,
  setPullRequestVote,
  updatePullRequestComment,
  updateWorkItemComment
} from "../src/azureDevOps/mutations.js";
import { jsonResponse, makeClient } from "./helpers.js";

describe("Azure DevOps mutations", () => {
  it("adds a Markdown comment to a work item through the comments preview API", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("POST");
      expect(url.pathname).toContain("/Project%20One/_apis/wit/workItems/544/comments");
      expect(url.searchParams.get("format")).toBe("markdown");
      expect(url.searchParams.get("api-version")).toBe("7.1-preview.4");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Implementation completed" });
      return jsonResponse({ workItemId: 544, commentId: 12, text: "Implementation completed", format: "markdown" });
    });
    const client = makeClient(fetch, { writeToolsEnabled: true });

    const result = await addWorkItemComment(client, "Project One", 544, "Implementation completed");

    expect(result.workItemId).toBe(544);
    expect(result.commentId).toBe(12);
  });

  it("updates a work item comment through the comments preview API", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("PATCH");
      expect(url.pathname).toContain("/Project%20One/_apis/wit/workItems/544/comments/12");
      expect(url.searchParams.get("api-version")).toBe("7.1-preview.4");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Türkçe açıklama" });
      return jsonResponse({ workItemId: 544, commentId: 12, version: 2, text: "Türkçe açıklama", isDeleted: false });
    });

    const result = await updateWorkItemComment(makeClient(fetch, { writeToolsEnabled: true }), "Project One", 544, 12, "Türkçe açıklama");

    expect(result).toMatchObject({ workItemId: 544, commentId: 12, version: 2, text: "Türkçe açıklama" });
  });

  it("deletes a work item comment and returns its soft-deleted representation", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("DELETE");
      expect(url.pathname).toContain("/Project%20One/_apis/wit/workItems/544/comments/12");
      expect(url.searchParams.get("api-version")).toBe("7.1-preview.4");
      return jsonResponse({ workItemId: 544, commentId: 12, version: 3, text: "Old", isDeleted: true });
    });

    const result = await deleteWorkItemComment(makeClient(fetch, { writeToolsEnabled: true }), "Project One", 544, 12);

    expect(result).toMatchObject({ workItemId: 544, commentId: 12, version: 3, isDeleted: true });
  });

  it("creates a draft pull request with normalized refs, reviewers, and linked work items", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("POST");
      expect(url.pathname).toContain("/Project%20One/_apis/git/repositories/repo/pullrequests");
      expect(url.searchParams.get("api-version")).toBe("7.1");
      expect(url.searchParams.get("supportsIterations")).toBe("true");
      expect(JSON.parse(String(init?.body))).toEqual({
        sourceRefName: "refs/heads/feature/ticket-544",
        targetRefName: "refs/heads/develop",
        title: "Implement ticket 544",
        description: "Adds the requested behavior.",
        isDraft: true,
        reviewers: [{ id: "reviewer-1" }],
        workItemRefs: [{ id: "544" }]
      });
      return jsonResponse({
        pullRequestId: 77,
        status: "active",
        title: "Implement ticket 544",
        sourceRefName: "refs/heads/feature/ticket-544",
        targetRefName: "refs/heads/develop",
        repository: { id: "repo", name: "repo" }
      });
    });
    const client = makeClient(fetch, { writeToolsEnabled: true });

    const result = await createPullRequest(client, "Project One", "repo", {
      sourceBranch: "feature/ticket-544",
      targetBranch: "develop",
      title: "Implement ticket 544",
      description: "Adds the requested behavior.",
      isDraft: true,
      reviewerIds: ["reviewer-1", "reviewer-1"],
      workItemIds: [544, 544],
      supportsIterations: true
    });

    expect(result.pullRequestId).toBe(77);
  });

  it("completes a pull request only at the reviewed source commit without bypassing policy", async () => {
    const sourceCommitId = "a".repeat(40);
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "GET") {
        return jsonResponse({
          pullRequestId: 77,
          status: "active",
          title: "Ready",
          sourceRefName: "refs/heads/feature/ready",
          targetRefName: "refs/heads/develop",
          isDraft: false,
          repository: { id: "repo", name: "repo" },
          lastMergeSourceCommit: { commitId: sourceCommitId }
        });
      }

      expect(init?.method).toBe("PATCH");
      expect(url.pathname).toContain("/Project%20One/_apis/git/repositories/repo/pullRequests/77");
      expect(url.searchParams.get("api-version")).toBe("7.1");
      expect(JSON.parse(String(init?.body))).toEqual({
        status: "completed",
        lastMergeSourceCommit: { commitId: sourceCommitId },
        completionOptions: {
          mergeStrategy: "squash",
          deleteSourceBranch: true,
          transitionWorkItems: true,
          bypassPolicy: false,
          mergeCommitMessage: "Merge ticket 544"
        }
      });
      return jsonResponse({
        pullRequestId: 77,
        status: "completed",
        title: "Ready",
        sourceRefName: "refs/heads/feature/ready",
        targetRefName: "refs/heads/develop",
        repository: { id: "repo", name: "repo" }
      });
    });
    const client = makeClient(fetch, { writeToolsEnabled: true });

    const result = await completePullRequest(client, "Project One", "repo", 77, {
      expectedSourceCommitId: sourceCommitId,
      mergeStrategy: "squash",
      deleteSourceBranch: true,
      transitionWorkItems: true,
      mergeCommitMessage: "Merge ticket 544"
    });

    expect(result.status).toBe("completed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects PR completion before PATCH when the source branch changed", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        pullRequestId: 77,
        status: "active",
        title: "Changed",
        sourceRefName: "refs/heads/feature/changed",
        targetRefName: "refs/heads/develop",
        repository: { id: "repo", name: "repo" },
        lastMergeSourceCommit: { commitId: "b".repeat(40) }
      })
    );
    const client = makeClient(fetch, { writeToolsEnabled: true });

    await expect(
      completePullRequest(client, "Project One", "repo", 77, {
        expectedSourceCommitId: "a".repeat(40),
        mergeStrategy: "noFastForward"
      })
    ).rejects.toThrow("source branch changed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("creates top-level comments with an active thread", async () => {
    const bodies: unknown[] = [];
    const fetch: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ id: 9, status: "active", comments: [{ id: 1, content: "Looks good" }] });
    };
    const client = makeClient(fetch, { writeToolsEnabled: true });

    const result = await createPullRequestComment(client, "Project", "repo", 3, "Looks good");
    expect(result.id).toBe(9);
    expect(bodies[0]).toEqual({
      comments: [{ parentCommentId: 0, content: "Looks good", commentType: 1 }],
      status: 1
    });
  });

  it("updates a pull request thread comment", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("PATCH");
      expect(url.pathname).toContain("/pullRequests/3/threads/9/comments/2");
      expect(url.searchParams.get("api-version")).toBe("7.1");
      expect(JSON.parse(String(init?.body))).toEqual({ content: "Türkçe açıklama" });
      return jsonResponse({ id: 2, parentCommentId: 1, content: "Türkçe açıklama", commentType: "text" });
    });

    const result = await updatePullRequestComment(makeClient(fetch, { writeToolsEnabled: true }), "Project", "repo", 3, 9, 2, "Türkçe açıklama");

    expect(result).toMatchObject({ id: 2, content: "Türkçe açıklama" });
  });

  it("deletes a pull request thread comment", async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method).toBe("DELETE");
      expect(url.pathname).toContain("/pullRequests/3/threads/9/comments/2");
      expect(url.searchParams.get("api-version")).toBe("7.1");
      return new Response(null, { status: 200 });
    });

    await expect(deletePullRequestComment(makeClient(fetch, { writeToolsEnabled: true }), "Project", "repo", 3, 9, 2)).resolves.toBeUndefined();
  });

  it("creates inline comments with validated iteration and line context", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      jsonResponse({ id: 10, requestBody: JSON.parse(String(init?.body)) })
    );
    const client = makeClient(fetch, { writeToolsEnabled: true });

    await createPullRequestInlineComment(client, "Project", "repo", 3, "Fix this", {
      valid: true,
      message: "ok",
      path: "/src/app.ts",
      iterationId: 2,
      changeTrackingId: 11,
      firstComparingIteration: 2,
      secondComparingIteration: 2,
      leftFileStart: null,
      leftFileEnd: null,
      rightFileStart: { line: 4, offset: 0 },
      rightFileEnd: { line: 4, offset: 12 }
    });

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.pullRequestThreadContext).toEqual({
      changeTrackingId: 11,
      iterationContext: { firstComparingIteration: 2, secondComparingIteration: 2 }
    });
    expect(body.threadContext.rightFileStart.line).toBe(4);
  });

  it("maps waitForAuthor to the Azure DevOps -5 vote for the current user", async () => {
    const calls: Array<{ url: URL; body?: unknown }> = [];
    const fetch: FetchLike = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (url.pathname.endsWith("/_apis/connectionData")) {
        return jsonResponse({ authenticatedUser: { id: "user-id", displayName: "Test User" } });
      }
      return jsonResponse({ id: "user-id", vote: -5 });
    };
    const client = makeClient(fetch, { writeToolsEnabled: true });

    const result = await setPullRequestVote(client, "Project", "repo", 3, "waitForAuthor");
    expect(result.voteValue).toBe(-5);
    expect(calls[1]?.url.pathname).toContain("/reviewers/user-id");
    expect(calls[1]?.body).toEqual({ vote: -5 });
  });
});
