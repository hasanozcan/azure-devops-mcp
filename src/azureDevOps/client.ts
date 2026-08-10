import { createAuthProvider, type AzureDevOpsAuthProvider } from "./auth.js";
import type { AzureDevOpsConfig, AzureDevOpsListResponse, PageResult, QueryParams } from "../types.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_ERROR_BODY_LENGTH = 8_000;

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class AzureDevOpsClientError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(message: string, options: { status?: number; code?: string; requestId?: string; details?: unknown; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AzureDevOpsClientError";
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class AzureDevOpsClient {
  readonly organization: string;
  readonly defaultProject?: string;
  readonly writeToolsEnabled: boolean;
  readonly maxDiffFileBytes: number;
  readonly maxDiffLines: number;
  readonly authMode: "pat" | "azcli";

  readonly #config: AzureDevOpsConfig;
  readonly #auth: AzureDevOpsAuthProvider;
  readonly #fetch: FetchLike;

  constructor(config: AzureDevOpsConfig, options: { auth?: AzureDevOpsAuthProvider; fetch?: FetchLike } = {}) {
    this.#config = config;
    this.#auth = options.auth ?? createAuthProvider(config);
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.organization = config.organization;
    if (config.defaultProject !== undefined) this.defaultProject = config.defaultProject;
    this.writeToolsEnabled = config.writeToolsEnabled;
    this.maxDiffFileBytes = config.maxDiffFileBytes;
    this.maxDiffLines = config.maxDiffLines;
    this.authMode = this.#auth.mode;
  }

  async get<T>(path: string, query: QueryParams = {}): Promise<T> {
    const response = await this.request("GET", path, { query, accept: "application/json" });
    return parseJsonResponse<T>(response);
  }

  async getPage<T>(path: string, query: QueryParams = {}): Promise<PageResult<T>> {
    const response = await this.request("GET", path, { query, accept: "application/json" });
    const body = await parseJsonResponse<AzureDevOpsListResponse<T>>(response);
    const continuationToken = response.headers.get("x-ms-continuationtoken") ?? undefined;
    return {
      items: body.value ?? [],
      count: body.count ?? body.value?.length ?? 0,
      ...(continuationToken ? { continuationToken } : {})
    };
  }

  async getText(path: string, query: QueryParams = {}): Promise<string> {
    const response = await this.request("GET", path, { query, accept: "text/plain, application/octet-stream;q=0.9" });
    return response.text();
  }

  async post<T>(path: string, body: unknown, query: QueryParams = {}): Promise<T> {
    const response = await this.request("POST", path, { query, body, accept: "application/json" });
    return parseJsonResponse<T>(response);
  }

  async put<T>(path: string, body: unknown, query: QueryParams = {}): Promise<T> {
    const response = await this.request("PUT", path, { query, body, accept: "application/json" });
    return parseJsonResponse<T>(response);
  }

  async patch<T>(path: string, body: unknown, query: QueryParams = {}): Promise<T> {
    const response = await this.request("PATCH", path, { query, body, accept: "application/json" });
    return parseJsonResponse<T>(response);
  }

  private async request(
    method: string,
    path: string,
    options: { query: QueryParams; body?: unknown; accept: string }
  ): Promise<Response> {
    const url = buildAzureDevOpsUrl(this.#config, path, options.query);
    const maxAttempts = method === "GET" || method === "HEAD" ? this.#config.retryCount + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#config.requestTimeoutMs);

      try {
        const authorization = await this.#auth.getAuthorizationHeader();
        const headers: Record<string, string> = {
          accept: options.accept,
          authorization,
          "user-agent": this.#config.userAgent
        };
        if (options.body !== undefined) {
          headers["content-type"] = "application/json";
        }

        const init: RequestInit = {
          method,
          headers,
          signal: controller.signal,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
        };

        const response = await this.#fetch(url, init);
        if (response.ok) {
          return response;
        }

        if (attempt < maxAttempts - 1 && RETRYABLE_STATUS_CODES.has(response.status)) {
          const delayMs = getRetryDelayMs(response, attempt);
          await response.arrayBuffer().catch(() => undefined);
          await delay(delayMs);
          continue;
        }

        throw await createResponseError(response, method, url);
      } catch (error) {
        if (error instanceof AzureDevOpsClientError) {
          throw error;
        }

        if (attempt < maxAttempts - 1) {
          await delay(getRetryDelayMs(undefined, attempt));
          continue;
        }

        if (isAbortError(error)) {
          throw new AzureDevOpsClientError(`Azure DevOps request timed out after ${this.#config.requestTimeoutMs} ms`, {
            code: "timeout",
            cause: error
          });
        }

        throw new AzureDevOpsClientError(error instanceof Error ? error.message : "Azure DevOps request failed", {
          code: "network_error",
          cause: error
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AzureDevOpsClientError("Azure DevOps request failed", { code: "request_failed" });
  }
}

export function buildAzureDevOpsUrl(config: AzureDevOpsConfig, path: string, query: QueryParams = {}): string {
  const base = `${config.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(config.organization)}/`;
  const url = new URL(path.replace(/^\/+/, ""), base);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value));
    }
  }
  if (!url.searchParams.has("api-version")) {
    url.searchParams.set("api-version", config.apiVersion);
  }
  return url.toString();
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function isAzureDevOpsNotFoundError(error: unknown): boolean {
  return error instanceof AzureDevOpsClientError && error.status === 404;
}

export function isAzureDevOpsAuthorizationError(error: unknown): boolean {
  return error instanceof AzureDevOpsClientError && (error.status === 401 || error.status === 403);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new AzureDevOpsClientError("Azure DevOps returned invalid JSON", {
      status: response.status,
      code: "invalid_json",
      details: text.slice(0, MAX_ERROR_BODY_LENGTH),
      cause: error
    });
  }
}

async function createResponseError(response: Response, method: string, url: string): Promise<AzureDevOpsClientError> {
  const requestId = response.headers.get("x-vss-e2eid") ?? response.headers.get("activityid") ?? undefined;
  const text = (await response.text()).slice(0, MAX_ERROR_BODY_LENGTH);
  let details: unknown = text;
  let message = `${method} ${new URL(url).pathname} failed with HTTP ${response.status}`;
  let code: string | undefined;

  if (text) {
    try {
      const payload = JSON.parse(text) as { message?: string; typeKey?: string; errorCode?: string | number };
      details = payload;
      if (payload.message) message = payload.message;
      code = payload.typeKey ?? (payload.errorCode === undefined ? undefined : String(payload.errorCode));
    } catch {
      message = `${message}: ${text}`;
    }
  }

  return new AzureDevOpsClientError(message, {
    status: response.status,
    ...(code ? { code } : {}),
    ...(requestId ? { requestId } : {}),
    ...(details === "" ? {} : { details })
  });
}

function getRetryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfterMs = response?.headers.get("x-ms-retry-after-ms");
  if (retryAfterMs && Number.isFinite(Number(retryAfterMs))) {
    return Math.max(0, Number(retryAfterMs));
  }

  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1_000);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - Date.now());
    }
  }

  return Math.min(5_000, 250 * 2 ** attempt);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
