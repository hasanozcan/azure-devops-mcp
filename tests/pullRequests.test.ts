import { describe, expect, it } from "vitest";

import { parsePullRequestUrl } from "../src/azureDevOps/pullRequests.js";

describe("parsePullRequestUrl", () => {
  it("parses dev.azure.com pull request URLs", () => {
    expect(parsePullRequestUrl("https://dev.azure.com/contoso/Platform/_git/API/pullrequest/42")).toEqual({
      organization: "contoso",
      project: "Platform",
      repository: "API",
      pullRequestId: 42
    });
  });

  it("parses legacy visualstudio.com URLs and decoded names", () => {
    expect(parsePullRequestUrl("https://contoso.visualstudio.com/Project%20One/_git/Repo%20One/pullrequest/7")).toEqual({
      organization: "contoso",
      project: "Project One",
      repository: "Repo One",
      pullRequestId: 7
    });
  });

  it("rejects unrelated URLs", () => {
    expect(() => parsePullRequestUrl("https://example.com/pullrequest/1")).toThrow("Azure DevOps");
  });
});
