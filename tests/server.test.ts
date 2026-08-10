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
    expect(names).toContain("validate_inline_comment_target");
    expect(names).toContain("create_pull_request_inline_comment");
    expect(names).toContain("request_pull_request_changes");
    expect(names).toHaveLength(28);
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
});
