import { AzureCliCredential } from "@azure/identity";

import type { AzureDevOpsConfig } from "../types.js";

const AZURE_DEVOPS_SCOPE = "499b84ac-1321-427f-aa17-267ca6975798/.default";
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1_000;

export interface AzureDevOpsAuthProvider {
  getAuthorizationHeader(): Promise<string>;
  readonly mode: "pat" | "azcli";
}

export function createAuthProvider(config: AzureDevOpsConfig): AzureDevOpsAuthProvider {
  if (config.authMode === "pat") {
    if (!config.pat) {
      throw new Error("PAT authentication selected but AZURE_DEVOPS_PAT is missing");
    }
    return new PatAuthProvider(config.pat);
  }

  return new AzureCliAuthProvider();
}

export class PatAuthProvider implements AzureDevOpsAuthProvider {
  readonly mode = "pat" as const;
  readonly #header: string;

  constructor(pat: string) {
    this.#header = `Basic ${Buffer.from(`:${pat}`, "utf8").toString("base64")}`;
  }

  async getAuthorizationHeader(): Promise<string> {
    return this.#header;
  }
}

export class AzureCliAuthProvider implements AzureDevOpsAuthProvider {
  readonly mode = "azcli" as const;
  readonly #credential: AzureCliCredential;
  #cachedToken?: { token: string; expiresOnTimestamp: number };

  constructor(credential: AzureCliCredential = new AzureCliCredential()) {
    this.#credential = credential;
  }

  async getAuthorizationHeader(): Promise<string> {
    const now = Date.now();
    if (this.#cachedToken && this.#cachedToken.expiresOnTimestamp - TOKEN_REFRESH_WINDOW_MS > now) {
      return `Bearer ${this.#cachedToken.token}`;
    }

    const token = await this.#credential.getToken(AZURE_DEVOPS_SCOPE);
    if (!token) {
      throw new Error("Azure CLI did not return an Azure DevOps access token. Run az login first.");
    }

    this.#cachedToken = {
      token: token.token,
      expiresOnTimestamp: token.expiresOnTimestamp
    };
    return `Bearer ${token.token}`;
  }
}
