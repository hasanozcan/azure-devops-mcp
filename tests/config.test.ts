import { describe, expect, it } from "vitest";

import { loadConfig, normalizeOrganization } from "../src/config.js";

describe("loadConfig", () => {
  it("loads PAT configuration with safe defaults", () => {
    const result = loadConfig({
      AZURE_DEVOPS_ORGANIZATION: "contoso",
      AZURE_DEVOPS_PAT: "real-test-secret",
      AZURE_DEVOPS_DEFAULT_PROJECT: "Platform"
    }).azureDevOps;

    expect(result.organization).toBe("contoso");
    expect(result.defaultProject).toBe("Platform");
    expect(result.authMode).toBe("pat");
    expect(result.apiVersion).toBe("7.1");
    expect(result.writeToolsEnabled).toBe(false);
  });

  it("allows Azure CLI authentication without a PAT", () => {
    const result = loadConfig({
      AZURE_DEVOPS_ORGANIZATION: "contoso",
      AZURE_DEVOPS_AUTH_MODE: "azcli"
    }).azureDevOps;

    expect(result.authMode).toBe("azcli");
    expect(result.pat).toBeUndefined();
  });

  it("rejects missing and placeholder PAT values", () => {
    expect(() => loadConfig({ AZURE_DEVOPS_ORGANIZATION: "contoso" })).toThrow("AZURE_DEVOPS_PAT");
    expect(() => loadConfig({ AZURE_DEVOPS_ORGANIZATION: "contoso", AZURE_DEVOPS_PAT: "replace-me" })).toThrow("placeholder");
  });

  it("parses boolean and numeric overrides", () => {
    const result = loadConfig({
      AZURE_DEVOPS_ORGANIZATION: "contoso",
      AZURE_DEVOPS_PAT: "real-secret",
      AZURE_DEVOPS_ENABLE_WRITE_TOOLS: "yes",
      AZURE_DEVOPS_RETRY_COUNT: "4",
      AZURE_DEVOPS_REQUEST_TIMEOUT_MS: "1500"
    }).azureDevOps;

    expect(result.writeToolsEnabled).toBe(true);
    expect(result.retryCount).toBe(4);
    expect(result.requestTimeoutMs).toBe(1500);
  });
});

describe("normalizeOrganization", () => {
  it("accepts organization names and both Azure DevOps URL formats", () => {
    expect(normalizeOrganization("contoso")).toBe("contoso");
    expect(normalizeOrganization("https://dev.azure.com/contoso/")).toBe("contoso");
    expect(normalizeOrganization("https://contoso.visualstudio.com")).toBe("contoso");
  });
});
