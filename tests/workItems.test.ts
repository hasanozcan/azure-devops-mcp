import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/azureDevOps/client.js";
import { getWorkItem, getWorkItemComments, queryWorkItems } from "../src/azureDevOps/workItems.js";
import { jsonResponse, makeClient } from "./helpers.js";

describe("Azure Boards work items", () => {
  it("gets a full work item with relations by default", async () => {
    const fetch: FetchLike = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain("/Project%20One/_apis/wit/workitems/42");
      expect(url.searchParams.get("$expand")).toBe("All");
      return jsonResponse({
        id: 42,
        fields: { "System.Title": "Fix ticket reading", "System.Description": "Full details" },
        relations: [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://example.test/41" }]
      });
    });

    const workItem = await getWorkItem(makeClient(fetch), "Project One", 42);

    expect(workItem.id).toBe(42);
    expect(workItem.fields?.["System.Description"]).toBe("Full details");
    expect(workItem.relations).toHaveLength(1);
  });

  it("runs WIQL and resolves work item details in query order", async () => {
    const fetch: FetchLike = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/_apis/wit/wiql")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ query: "SELECT [System.Id] FROM WorkItems" });
        expect(url.searchParams.get("$top")).toBe("2");
        return jsonResponse({ queryType: "flat", workItems: [{ id: 2 }, { id: 1 }] });
      }

      expect(url.pathname).toBe("/contoso/_apis/wit/workitems");
      expect(url.searchParams.get("ids")).toBe("2,1");
      expect(url.searchParams.get("fields")).toContain("System.Title");
      return jsonResponse({ count: 2, value: [{ id: 1 }, { id: 2 }] });
    });

    const result = await queryWorkItems(makeClient(fetch), "Project One", "SELECT [System.Id] FROM WorkItems", { top: 2 });

    expect(result.queryResult.queryType).toBe("flat");
    expect(result.workItems.map((item) => item.id)).toEqual([2, 1]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("limits WIQL queries to 100 items by default", async () => {
    const fetch: FetchLike = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("$top")).toBe("100");
      return jsonResponse({ queryType: "flat", workItems: [] });
    });

    const result = await queryWorkItems(makeClient(fetch), "Project One", "SELECT [System.Id] FROM WorkItems");

    expect(result.workItems).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("lists pageable work item comments using the preview API", async () => {
    const fetch: FetchLike = vi.fn(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain("/Project%20One/_apis/wit/workItems/42/comments");
      expect(url.searchParams.get("api-version")).toBe("7.1-preview.4");
      expect(url.searchParams.get("$top")).toBe("10");
      expect(url.searchParams.get("order")).toBe("desc");
      return jsonResponse({
        totalCount: 2,
        count: 1,
        comments: [{ workItemId: 42, commentId: 7, text: "Investigating" }],
        continuationToken: "next-token"
      });
    });

    const page = await getWorkItemComments(makeClient(fetch), "Project One", 42, { top: 10, order: "desc" });

    expect(page.comments[0]?.text).toBe("Investigating");
    expect(page.totalCount).toBe(2);
    expect(page.continuationToken).toBe("next-token");
  });
});
