# Architecture

```text
MCP client
  -> src/server.ts
     -> src/tools/*
        -> src/azureDevOps/*
           -> Azure DevOps REST API 7.1
        -> src/review/*
           -> iteration changes + item contents + local unified diff
```

## Boundaries

- `config.ts` validates all startup configuration and rejects placeholder credentials.
- `azureDevOps/auth.ts` isolates PAT and Azure CLI token acquisition.
- `azureDevOps/client.ts` owns authorization headers, API versioning, timeouts, safe retries, continuation tokens, and error normalization.
- `azureDevOps/*.ts` modules are thin typed REST endpoint adapters.
- `review/diffEngine.ts` owns PR iteration resolution, file content retrieval, bounded concurrency, diff generation, statistics, and short-lived caching.
- `review/inlineTargetValidator.ts` resolves the exact iteration and `changeTrackingId` used by inline thread creation.
- `tools/*.ts` define MCP schemas, response shapes, default-project resolution, and mutation gates.

## Error model

Known Azure DevOps HTTP errors are returned as structured tool results:

```json
{
  "error": {
    "code": "not_found",
    "message": "...",
    "status": 404,
    "requestId": "..."
  }
}
```

Local validation errors remain MCP tool errors because no Azure DevOps mutation occurred.

## Retry model

Only GET/HEAD requests retry automatically. Retryable status codes are `429`, `500`, `502`, `503`, and `504`. The client honors `x-ms-retry-after-ms` and `Retry-After`, then falls back to bounded exponential delay.

POST, PUT, and PATCH requests are never retried automatically to avoid duplicate comments or ambiguous mutations.
