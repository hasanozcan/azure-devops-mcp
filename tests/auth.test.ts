import { describe, expect, it } from "vitest";

import { PatAuthProvider } from "../src/azureDevOps/auth.js";

describe("PatAuthProvider", () => {
  it("uses Azure DevOps Basic auth with an empty username", async () => {
    const provider = new PatAuthProvider("secret");
    const header = await provider.getAuthorizationHeader();

    expect(header).toBe(`Basic ${Buffer.from(":secret").toString("base64")}`);
  });
});
