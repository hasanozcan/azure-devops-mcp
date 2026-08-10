# Architecture

```text
MCP client (Codex, VS Code, or another stdio client)
  -> src/server.ts
     -> src/tools/*
        -> src/azureDevOps/*
           -> Azure DevOps REST APIs
        -> src/review/*
           -> PR iterations + Git item contents + local unified diff
```

## Module boundaries

- `config.ts` validates startup configuration and rejects placeholder credentials.
- `azureDevOps/auth.ts` isolates PAT and Azure CLI token acquisition.
- `azureDevOps/client.ts` owns authorization headers, API versioning, timeouts, safe read retries, continuation tokens, JSON/JSON Patch/binary bodies, DELETE requests, and error normalization.
- `azureDevOps/workItems.ts` and `workItemMutations.ts` cover Boards reads, WIQL, comments, JSON Patch updates, relations, and attachments.
- `azureDevOps/pullRequests.ts`, `mutations.ts`, and `prLifecycle.ts` cover PR reads, review writes, lifecycle, reviewers, and labels.
- `azureDevOps/branches.ts` and `branchLifecycle.ts` cover refs, safe ref updates, comparisons, and stale discovery.
- `azureDevOps/pipelines.ts` covers Pipelines and Build endpoints, including bounded log retrieval.
- `azureDevOps/sprints.ts` covers team iterations, work items, capacity, velocity calculation, and backlog order.
- `azureDevOps/quality.ts` composes existing adapters into advisory readiness, stale, trace, and audit reports.
- `review/diffEngine.ts` owns iteration resolution, file retrieval, bounded concurrency, unified diffs, statistics, and a short-lived cache.
- `review/inlineTargetValidator.ts` resolves the exact current iteration and `changeTrackingId` required for inline comments.
- `tools/*.ts` define MCP schemas, response shapes, default-project resolution, and shared mutation gates.

## Request and safety model

Read operations use `GET` and may retry transient `429`, `500`, `502`, `503`, and `504` responses. The client honors `x-ms-retry-after-ms` and `Retry-After`, then uses bounded exponential delay.

`POST`, `PUT`, `PATCH`, and `DELETE` requests are never retried automatically. This avoids duplicate comments, duplicated runs, and ambiguous mutations.

All write tools call the shared mutation gate before any network request:

```text
AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true
  AND tool input confirm=true
    -> mutation may execute
```

Optimistic checks add resource-specific protection:

- work item revision test (`expectedRevision`);
- branch old object ID (`expectedObjectId`);
- current PR iteration and inline `changeTrackingId`;
- current PR source commit (`expectedSourceCommitId`);
- policy bypass fixed to `false`.

## Composite reports

Quality tools intentionally compose multiple Azure DevOps reads:

- merge readiness combines project identity, PR metadata, reviewers, threads, policy evaluations, and PR statuses;
- batch review summary combines PR listing, reviewers, and threads;
- stale report combines refs/commits with active PR age;
- delivery trace categorizes expanded work item artifact relations;
- velocity resolves iteration relations, batches work items, and totals a configurable point field.

These reports are advisory snapshots. Azure DevOps remains authoritative for merge policies, permissions, process rules, and queue-time validation.

## Error model

Known Azure DevOps HTTP errors become structured tool results:

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

Local schema, confirmation, stale-revision, and safety validation failures remain MCP tool errors because no successful Azure DevOps mutation occurred.

## Output bounds

- local diff generation obeys file-byte and line limits;
- attachments are limited to 10 MiB before upload;
- fetched build logs default to 100,000 characters and are capped at 1,000,000 by schema;
- batch review reports accept at most 50 PRs;
- stale scans and API listing tools expose explicit bounded `top` values.
