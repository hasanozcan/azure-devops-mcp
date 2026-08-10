#!/usr/bin/env node
import "dotenv/config";

import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { AzureDevOpsClient } from "./azureDevOps/client.js";
import { listProjects } from "./azureDevOps/projects.js";
import type { AzureDevOpsAuthMode, AzureDevOpsConfig } from "./types.js";

interface SetupFlags {
  force: boolean;
  skipValidation: boolean;
}

interface SetupValues {
  organization: string;
  defaultProject?: string;
  authMode: AzureDevOpsAuthMode;
  pat?: string;
}

export async function runSetup(argv: string[] = process.argv.slice(2)): Promise<void> {
  const flags = parseFlags(argv);
  const envPath = resolve(process.cwd(), ".env");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    if ((await fileExists(envPath)) && !flags.force) {
      const overwrite = (await rl.question(".env already exists. Overwrite it? [y/N] ")).trim().toLowerCase();
      if (overwrite !== "y" && overwrite !== "yes") {
        process.stdout.write("Setup cancelled; existing .env was not changed.\n");
        return;
      }
    }

    const organization = requireAnswer(
      await rl.question(`Azure DevOps organization [${process.env.AZURE_DEVOPS_ORGANIZATION ?? ""}]: `),
      process.env.AZURE_DEVOPS_ORGANIZATION,
      "organization"
    );
    const defaultProjectAnswer = await rl.question(`Default project (optional) [${process.env.AZURE_DEVOPS_DEFAULT_PROJECT ?? ""}]: `);
    const defaultProject = defaultProjectAnswer.trim() || process.env.AZURE_DEVOPS_DEFAULT_PROJECT?.trim() || undefined;
    const authModeAnswer = (await rl.question(`Authentication mode pat/azcli [${process.env.AZURE_DEVOPS_AUTH_MODE ?? "pat"}]: `)).trim().toLowerCase();
    const authMode = parseAuthMode(authModeAnswer || process.env.AZURE_DEVOPS_AUTH_MODE || "pat");
    let pat = process.env.AZURE_DEVOPS_PAT?.trim();

    if (authMode === "pat" && !pat) {
      process.stdout.write("PAT input may be visible in this terminal. You can cancel and set AZURE_DEVOPS_PAT in the process environment instead.\n");
      pat = (await rl.question("Azure DevOps PAT: ")).trim();
    }
    if (authMode === "pat" && !pat) {
      throw new Error("PAT authentication requires a non-empty Azure DevOps PAT");
    }

    const values: SetupValues = {
      organization,
      ...(defaultProject ? { defaultProject } : {}),
      authMode,
      ...(pat ? { pat } : {})
    };

    if (!flags.skipValidation) {
      process.stdout.write("Validating Azure DevOps access...\n");
      const client = new AzureDevOpsClient(toRuntimeConfig(values));
      await listProjects(client, { top: 1 });
    }

    await writeFile(envPath, buildEnvContent(values), { encoding: "utf8", mode: 0o600 });
    process.stdout.write(`Configuration written to ${envPath}\n`);
    process.stdout.write("Run npm run doctor to verify the saved configuration.\n");
  } finally {
    rl.close();
  }
}

export function buildEnvContent(values: SetupValues): string {
  return [
    `AZURE_DEVOPS_ORGANIZATION=${quoteEnv(values.organization)}`,
    `AZURE_DEVOPS_DEFAULT_PROJECT=${quoteEnv(values.defaultProject ?? "")}`,
    `AZURE_DEVOPS_AUTH_MODE=${values.authMode}`,
    `AZURE_DEVOPS_PAT=${quoteEnv(values.pat ?? "")}`,
    "AZURE_DEVOPS_BASE_URL=https://dev.azure.com",
    "AZURE_DEVOPS_API_VERSION=7.1",
    "AZURE_DEVOPS_ENABLE_WRITE_TOOLS=false",
    "AZURE_DEVOPS_REQUEST_TIMEOUT_MS=30000",
    "AZURE_DEVOPS_RETRY_COUNT=2",
    "AZURE_DEVOPS_MAX_DIFF_FILE_BYTES=1048576",
    "AZURE_DEVOPS_MAX_DIFF_LINES=5000",
    ""
  ].join("\n");
}

function toRuntimeConfig(values: SetupValues): AzureDevOpsConfig {
  return {
    organization: values.organization,
    baseUrl: "https://dev.azure.com",
    apiVersion: "7.1",
    authMode: values.authMode,
    ...(values.pat ? { pat: values.pat } : {}),
    ...(values.defaultProject ? { defaultProject: values.defaultProject } : {}),
    userAgent: "azure-devops-pr-mcp-setup/0.2.0",
    requestTimeoutMs: 30_000,
    retryCount: 2,
    writeToolsEnabled: false,
    maxDiffFileBytes: 1_048_576,
    maxDiffLines: 5_000
  };
}

function parseFlags(argv: string[]): SetupFlags {
  const unknown = argv.filter((arg) => arg !== "--force" && arg !== "--skip-validation");
  if (unknown.length > 0) {
    throw new Error(`Unknown setup option(s): ${unknown.join(", ")}`);
  }
  return {
    force: argv.includes("--force"),
    skipValidation: argv.includes("--skip-validation")
  };
}

function parseAuthMode(value: string): AzureDevOpsAuthMode {
  if (value === "pat" || value === "azcli") return value;
  throw new Error("Authentication mode must be pat or azcli");
}

function requireAnswer(answer: string, fallback: string | undefined, label: string): string {
  const value = answer.trim() || fallback?.trim();
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function quoteEnv(value: string): string {
  return JSON.stringify(value);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runSetup().catch((error: unknown) => {
    process.stderr.write(`Setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
