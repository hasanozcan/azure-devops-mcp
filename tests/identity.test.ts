import { expect, it, vi } from "vitest";

import type { FetchLike } from "../src/azureDevOps/client.js";
import { getConnectionData } from "../src/azureDevOps/identity.js";
import { jsonResponse, makeClient } from "./helpers.js";

it("uses the preview API required by connectionData", async () => {
  const fetch: FetchLike = vi.fn(async (input) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("api-version")).toBe("7.1-preview.1");
    return jsonResponse({ authenticatedUser: { id: "user-1", displayName: "Test User" } });
  });

  const result = await getConnectionData(makeClient(fetch));

  expect(result.authenticatedUser?.displayName).toBe("Test User");
});
