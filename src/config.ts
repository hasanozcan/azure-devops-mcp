import type { AppConfig, AzureDevOpsAuthMode } from "./types.js";

const DEFAULT_BASE_URL = "https://dev.azure.com";
const DEFAULT_API_VERSION = "7.1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_MAX_DIFF_FILE_BYTES = 1_048_576;
const DEFAULT_MAX_DIFF_LINES = 5_000;
const DEFAULT_USER_AGENT = "azure-devops-pr-mcp/0.2.0";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const organization = normalizeOrganization(requireValue(env.AZURE_DEVOPS_ORGANIZATION, "AZURE_DEVOPS_ORGANIZATION"));
  const authMode = parseAuthMode(env.AZURE_DEVOPS_AUTH_MODE);
  const pat = env.AZURE_DEVOPS_PAT?.trim();

  if (authMode === "pat") {
    if (!pat) {
      throw new Error("Missing required environment variable for PAT authentication: AZURE_DEVOPS_PAT");
    }
    if (isPlaceholderSecret(pat)) {
      throw new Error("Invalid AZURE_DEVOPS_PAT: placeholder values are not allowed");
    }
  }

  return {
    azureDevOps: {
      organization,
      baseUrl: normalizeBaseUrl(env.AZURE_DEVOPS_BASE_URL?.trim() || DEFAULT_BASE_URL),
      apiVersion: env.AZURE_DEVOPS_API_VERSION?.trim() || DEFAULT_API_VERSION,
      authMode,
      ...(pat ? { pat } : {}),
      ...(env.AZURE_DEVOPS_DEFAULT_PROJECT?.trim() ? { defaultProject: env.AZURE_DEVOPS_DEFAULT_PROJECT.trim() } : {}),
      userAgent: DEFAULT_USER_AGENT,
      requestTimeoutMs: parsePositiveInteger(env.AZURE_DEVOPS_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, "AZURE_DEVOPS_REQUEST_TIMEOUT_MS"),
      retryCount: parseNonNegativeInteger(env.AZURE_DEVOPS_RETRY_COUNT, DEFAULT_RETRY_COUNT, "AZURE_DEVOPS_RETRY_COUNT"),
      writeToolsEnabled: parseBoolean(env.AZURE_DEVOPS_ENABLE_WRITE_TOOLS, false, "AZURE_DEVOPS_ENABLE_WRITE_TOOLS"),
      maxDiffFileBytes: parsePositiveInteger(env.AZURE_DEVOPS_MAX_DIFF_FILE_BYTES, DEFAULT_MAX_DIFF_FILE_BYTES, "AZURE_DEVOPS_MAX_DIFF_FILE_BYTES"),
      maxDiffLines: parsePositiveInteger(env.AZURE_DEVOPS_MAX_DIFF_LINES, DEFAULT_MAX_DIFF_LINES, "AZURE_DEVOPS_MAX_DIFF_LINES")
    }
  };
}

export function normalizeOrganization(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() === "dev.azure.com") {
      const organization = url.pathname.split("/").filter(Boolean)[0];
      if (!organization) {
        throw new Error("AZURE_DEVOPS_ORGANIZATION URL must include an organization name");
      }
      return organization;
    }

    const visualStudioMatch = /^([^.]+)\.visualstudio\.com$/i.exec(url.hostname);
    if (visualStudioMatch?.[1]) {
      return visualStudioMatch[1];
    }

    throw new Error("AZURE_DEVOPS_ORGANIZATION must be an organization name or an Azure DevOps Services URL");
  }

  if (trimmed.includes("/")) {
    throw new Error("AZURE_DEVOPS_ORGANIZATION must not contain path separators");
  }

  if (!trimmed) {
    throw new Error("AZURE_DEVOPS_ORGANIZATION cannot be empty");
  }

  return trimmed;
}

function requireValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("AZURE_DEVOPS_BASE_URL must use http or https");
  }
  return url.toString().replace(/\/+$/, "");
}

function parseAuthMode(value: string | undefined): AzureDevOpsAuthMode {
  const normalized = value?.trim().toLowerCase() || "pat";
  if (normalized !== "pat" && normalized !== "azcli") {
    throw new Error("AZURE_DEVOPS_AUTH_MODE must be either pat or azcli");
  }
  return normalized;
}

function isPlaceholderSecret(value: string): boolean {
  return /^(replace[-_ ]?me|your[-_ ].*|changeme|example|token|pat)$/i.test(value.trim());
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`${name} must be a boolean value`);
}
