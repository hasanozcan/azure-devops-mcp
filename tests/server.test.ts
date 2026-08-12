import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/azureDevOps/client.js";
import { createServer } from "../src/server.js";
import { makeClient, jsonResponse } from "./helpers.js";

describe("MCP server", () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  });

  it("registers the complete focused tool surface", async () => {
    const fetch: FetchLike = vi.fn(async () => jsonResponse({ count: 0, value: [] }));
    const server = createServer(makeClient(fetch));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);

    expect(names).toContain("get_pull_request_review_context");
    expect(names).toContain("get_work_item");
    expect(names).toContain("query_work_items");
    expect(names).toContain("get_work_item_comments");
    expect(names).toContain("add_work_item_comment");
    expect(names).toContain("update_work_item_comment");
    expect(names).toContain("delete_work_item_comment");
    expect(names).toContain("create_pull_request");
    expect(names).toContain("complete_pull_request");
    expect(names).toContain("create_work_item");
    expect(names).toContain("update_work_item");
    expect(names).toContain("set_pull_request_auto_complete");
    expect(names).toContain("compare_branches");
    expect(names).toContain("run_pipeline");
    expect(names).toContain("get_iteration_velocity");
    expect(names).toContain("get_pull_request_merge_readiness");
    expect(names).toContain("validate_inline_comment_target");
    expect(names).toContain("create_pull_request_inline_comment");
    expect(names).toContain("update_pull_request_comment");
    expect(names).toContain("delete_pull_request_comment");
    expect(names).toContain("request_pull_request_changes");
    expect(names).toHaveLength(68);
  });

  it("blocks mutation calls before any network request when confirmation is false", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const server = createServer(makeClient(fetch, { writeToolsEnabled: true }));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "create_pull_request_comment",
      arguments: {
        project: "Project One",
        repositoryId: "repo",
        pullRequestId: 1,
        content: "Comment",
        confirm: false
      }
    });

    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks work item comments before any network request when confirmation is false", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const server = createServer(makeClient(fetch, { writeToolsEnabled: true }));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "add_work_item_comment",
      arguments: {
        project: "Project One",
        workItemId: 544,
        text: "Comment",
        confirm: false
      }
    });

    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks pull request comment deletion before any network request when confirmation is false", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const server = createServer(makeClient(fetch, { writeToolsEnabled: true }));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "delete_pull_request_comment",
      arguments: {
        project: "Project One",
        repositoryId: "repo",
        pullRequestId: 77,
        threadId: 9,
        commentId: 2,
        confirm: false
      }
    });

    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks pull request creation before any network request when confirmation is false", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const server = createServer(makeClient(fetch, { writeToolsEnabled: true }));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "create_pull_request",
      arguments: {
        project: "Project One",
        repositoryId: "repo",
        sourceBranch: "feature/ticket-544",
        targetBranch: "develop",
        title: "Implement ticket 544",
        confirm: false
      }
    });

    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks pull request completion before reading or updating the PR when confirmation is false", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const server = createServer(makeClient(fetch, { writeToolsEnabled: true }));
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeCallbacks.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      name: "complete_pull_request",
      arguments: {
        project: "Project One",
        repositoryId: "repo",
        pullRequestId: 77,
        expectedSourceCommitId: "a".repeat(40),
        mergeStrategy: "squash",
        confirm: false
      }
    });

    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
