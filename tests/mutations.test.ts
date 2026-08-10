import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/azureDevOps/client.js";
import { addWorkItemComment, createPullRequestComment, createPullRequestInlineComment, setPullRequestVote } from "../src/azureDevOps/mutations.js";
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
