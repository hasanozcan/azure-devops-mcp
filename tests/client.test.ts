import { describe, expect, it, vi } from "vitest";

import { AzureDevOpsClientError, buildAzureDevOpsUrl } from "../src/azureDevOps/client.js";
import { jsonResponse, makeClient, makeConfig } from "./helpers.js";

describe("buildAzureDevOpsUrl", () => {
  it("adds organization, encoded paths, query values, and API version", () => {
    const url = new URL(buildAzureDevOpsUrl(makeConfig(), "Project%20One/_apis/git/repositories", { "$top": 10 }));

    expect(url.pathname).toBe("/contoso/Project%20One/_apis/git/repositories");
    expect(url.searchParams.get("$top")).toBe("10");
    expect(url.searchParams.get("api-version")).toBe("7.1");
  });
});

describe("AzureDevOpsClient", () => {
  it("sends authentication and parses JSON", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toMatch(/^Basic /);
      expect(headers.get("user-agent")).toContain("tests");
      return jsonResponse({ value: [{ id: "1" }], count: 1 }, { headers: { "x-ms-continuationtoken": "next" } });
    });
    const client = makeClient(fetch);

    const page = await client.getPage<{ id: string }>("_apis/projects");
    expect(page.items).toEqual([{ id: "1" }]);
    expect(page.continuationToken).toBe("next");
  });

  it("retries retryable GET failures", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "x-ms-retry-after-ms": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = makeClient(fetch, { retryCount: 1 });

    await expect(client.get("_apis/projects")).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry mutations and normalizes API errors", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(
        { message: "Denied", typeKey: "AccessDeniedException" },
        { status: 403, headers: { "x-vss-e2eid": "request-1" } }
      )
    );
    const client = makeClient(fetch, { retryCount: 3 });

    const error = await client.post("_apis/example", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AzureDevOpsClientError);
    expect(error).toMatchObject({ status: 403, code: "AccessDeniedException", requestId: "request-1", message: "Denied" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
