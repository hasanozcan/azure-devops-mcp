import { describe, expect, it } from "vitest";

import type { FetchLike } from "../src/azureDevOps/client.js";
import { PullRequestDiffService, buildUnifiedDiff, countTextLines, getTextLine } from "../src/review/diffEngine.js";
import { validateInlineCommentTarget } from "../src/review/inlineTargetValidator.js";
import { jsonResponse, makeClient } from "./helpers.js";

function createDiffFetch(): FetchLike {
  return async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;

    if (path.endsWith("/iterations/2/changes")) {
      return jsonResponse({
        changeEntries: [
          {
            changeId: 1,
            changeTrackingId: 11,
            changeType: "edit",
            item: { path: "/src/app.ts", isFolder: false }
          }
        ]
      });
    }
    if (path.endsWith("/iterations/2")) {
      return jsonResponse({
        id: 2,
        commonRefCommit: { commitId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        sourceRefCommit: { commitId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        targetRefCommit: { commitId: "cccccccccccccccccccccccccccccccccccccccc" }
      });
    }
    if (path.endsWith("/iterations")) {
      return jsonResponse({ count: 2, value: [{ id: 1 }, { id: 2 }] });
    }
    if (path.endsWith("/items")) {
      const version = url.searchParams.get("versionDescriptor.version");
      return new Response(version?.startsWith("a") ? "const a = 1;\n" : "const a = 1;\nconst b = 2;\n", { status: 200 });
    }
    throw new Error(`Unexpected test URL: ${url}`);
  };
}

describe("PullRequestDiffService", () => {
  it("builds unified file and pull request diffs from iteration content", async () => {
    const client = makeClient(createDiffFetch());
    const service = new PullRequestDiffService(client);
    const bundle = await service.getBundle("Project One", "repo", 42);

    expect(bundle.iterationId).toBe(2);
    expect(bundle.totalFiles).toBe(1);
    expect(bundle.additions).toBe(1);
    expect(bundle.deletions).toBe(0);
    expect(bundle.files[0]?.patch).toContain("+const b = 2;");
    expect(buildUnifiedDiff(bundle, { maxLines: 100 }).text).toContain("src/app.ts");
  });

  it("validates right-side inline comment lines against current content", async () => {
    const client = makeClient(createDiffFetch());
    const service = new PullRequestDiffService(client);

    const valid = await validateInlineCommentTarget(client, service, "Project One", "repo", 42, {
      path: "src/app.ts",
      toLine: 2
    });
    const invalid = await validateInlineCommentTarget(client, service, "Project One", "repo", 42, {
      path: "src/app.ts",
      toLine: 3
    });

    expect(valid).toMatchObject({
      valid: true,
      changeTrackingId: 11,
      iterationId: 2,
      firstComparingIteration: 1,
      secondComparingIteration: 2
    });
    expect(valid.rightFileStart).toEqual({ line: 2, offset: 1 });
    expect(invalid.valid).toBe(false);
    expect(invalid.message).toContain("outside the new file");
  });
});

describe("countTextLines", () => {
  it("handles empty, terminated, and unterminated text", () => {
    expect(countTextLines("")).toBe(0);
    expect(countTextLines("a\n")).toBe(1);
    expect(countTextLines("a\nb")).toBe(2);
    expect(getTextLine("", 1)).toBeUndefined();
  });
});
