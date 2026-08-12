# Azure DevOps MCP Server

Local Model Context Protocol (MCP) server for **Azure DevOps Services**. It exposes 68 tools for Azure Boards, Azure Repos, pull request review and lifecycle management, Azure Pipelines, team sprints/backlogs, and delivery reporting.

Read tools are enabled by default. Every mutation requires both a server-side feature flag and an explicit per-call confirmation. Pull request completion and auto-complete never bypass branch policies.

## Capabilities

### Azure Boards

- Read work items, every field, relations, comments, and historical snapshots.
- Run read-only WIQL `SELECT` queries and resolve the matching work items.
- Create and update work items, including state, assignee, tags, area, sprint, and custom fields.
- Add, edit, and soft-delete work item comments; add parent/child/related/dependency/duplicate links and attachments up to 10 MiB.
- Use an expected revision to prevent stale work item updates.
- Trace a ticket to linked pull requests, commits, builds, branches, and related work items.
- Read the work item's field and relation update history.

### Repositories and branches

- List projects, repositories, clone links, branches, and commits.
- Create a branch at an exact commit.
- Delete a branch only when its current object ID matches the caller's expectation.
- Compare branches with ahead/behind counts and changed items.
- Find stale branches while excluding protected branch names.

### Pull requests and code review

- List and retrieve pull requests, including direct Azure DevOps PR URLs.
- Read commits, reviewers/votes, iterations, threads, comments, labels, and linked work items.
- Generate bounded unified diffs locally and validate exact inline-comment targets.
- Create and update PRs; switch draft state; abandon or reactivate a PR.
- Add/remove reviewers and labels; create, reply to, edit, soft-delete, and resolve review comments; cast votes.
- Enable policy-respecting auto-complete or merge at an exact reviewed source SHA.
- Evaluate merge readiness from draft/status, merge state, votes, required reviewers, unresolved threads, policy evaluations, and PR status checks.
- Produce batch review summaries and stale PR reports.

### Azure Pipelines

- List pipelines, runs, and builds; inspect run state/result.
- Filter builds by definition, repository, branch, status, and result.
- Queue or preview a run with a branch, variables, template parameters, and skipped stages.
- Re-run a full pipeline using a previous run's resolved resources.
- List build log records and retrieve bounded log text.

Azure DevOps REST does not expose a generic failed-job-only rerun through this implementation; `rerun_pipeline` queues a full run.

### Sprints and backlogs

- List team iterations by current, past, or future timeframe.
- Get the work items and team-member capacity for a sprint.
- Calculate item and story-point velocity with configurable point field and completed states.
- Reorder or reparent backlog items.
- Move a work item to a sprint through `update_work_item` and `System.IterationPath`.

## Tool groups

| Group | Count | Coverage |
| --- | ---: | --- |
| Core and repository reads | 6 | Auth, projects, repositories, clone links, branch listing |
| Azure Boards | 10 | Work items, WIQL, comment lifecycle, create/update, relations, attachments |
| Pull requests and history | 10 | PR metadata, commits, threads, iterations, reviewers, linked work items |
| Review and diff | 6 | Changed files, stats, unified diffs, inline validation, review context |
| PR review and lifecycle writes | 15 | PR create/update/merge, auto-complete, comment lifecycle, votes, reviewers, labels |
| Branch lifecycle | 4 | Create, delete, compare, stale branches |
| Pipelines and builds | 7 | Definitions, runs, queue/rerun, logs, build filters |
| Sprints and backlog | 5 | Iterations, work items, capacity, velocity, reorder |
| Quality and trace reports | 5 | Merge readiness, batch/stale reports, delivery trace, audit history |
| **Total** | **68** | |

The complete input reference is in [docs/tools.md](docs/tools.md).

## Requirements

- Node.js 20+
- npm
- An Azure DevOps Services organization
- An Azure DevOps PAT or an Azure CLI session created with `az login`

Azure DevOps Server/on-premises is not currently supported.

## Quick start

```powershell
git clone https://github.com/hasanozcan/azure-devops-mcp.git
cd azure-devops-mcp
npm install
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
AZURE_DEVOPS_ORGANIZATION=your-organization
AZURE_DEVOPS_DEFAULT_PROJECT=your-project
AZURE_DEVOPS_AUTH_MODE=pat
AZURE_DEVOPS_PAT=your-token
AZURE_DEVOPS_ENABLE_WRITE_TOOLS=false
```

Then validate and build:

```powershell
npm run doctor
npm run build
npm start
```

The transport is local `stdio`; stdout is reserved for MCP protocol messages.

## Finding organization and project values

For a URL such as:

```text
https://thecellsolutions.visualstudio.com/hpowere/_git/hpower/pullrequests
```

use:

```dotenv
AZURE_DEVOPS_ORGANIZATION=thecellsolutions
AZURE_DEVOPS_DEFAULT_PROJECT=hpowere
```

For `https://dev.azure.com/<organization>/<project>/...`, use the first path segment as the organization and the second as the project.

## Authentication and permissions

Recommended PAT permissions depend on the tools you enable:

| Capability | PAT permission |
| --- | --- |
| Repository, branch, commit, PR, and diff reads | Code: Read |
| PR/branch/reviewer/label/comment mutations | Code: Read & write |
| Work item, WIQL, comment, history, sprint-item reads | Work Items: Read |
| Work item creation/update/comments/relations/attachments/backlog reorder | Work Items: Read & write |
| Pipeline, run, build, and log reads | Build: Read |
| Queue, preview, or rerun pipelines | Build: Read & execute |
| Iteration and capacity discovery | Project and Team: Read |

Use the shortest practical PAT expiration. See [docs/auth.md](docs/auth.md).

Azure CLI mode:

```powershell
az login
```

```dotenv
AZURE_DEVOPS_AUTH_MODE=azcli
AZURE_DEVOPS_PAT=
```

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AZURE_DEVOPS_ORGANIZATION` | Yes | None | Organization name or Azure DevOps URL |
| `AZURE_DEVOPS_DEFAULT_PROJECT` | No | None | Project used when a tool omits `project` |
| `AZURE_DEVOPS_AUTH_MODE` | No | `pat` | `pat` or `azcli` |
| `AZURE_DEVOPS_PAT` | PAT mode | None | Personal Access Token |
| `AZURE_DEVOPS_BASE_URL` | No | `https://dev.azure.com` | REST API base URL |
| `AZURE_DEVOPS_API_VERSION` | No | `7.1` | Default REST API version |
| `AZURE_DEVOPS_ENABLE_WRITE_TOOLS` | No | `false` | Enable guarded mutations |
| `AZURE_DEVOPS_REQUEST_TIMEOUT_MS` | No | `30000` | Per-request timeout |
| `AZURE_DEVOPS_RETRY_COUNT` | No | `2` | Retry count for safe reads |
| `AZURE_DEVOPS_MAX_DIFF_FILE_BYTES` | No | `1048576` | Per-side local diff file limit |
| `AZURE_DEVOPS_MAX_DIFF_LINES` | No | `5000` | Maximum returned diff lines |

Placeholder secrets such as `replace-me` are rejected at startup.

## Codex configuration

The repository includes [`.codex/config.toml`](.codex/config.toml). Build the project, create `.env`, trust/open the repository in Codex, and restart the MCP server list.

Manual registration:

```powershell
codex mcp add azure-devops-mcp -- node "<absolute-path-to-project>\dist\server.js"
```

The project configuration uses `default_tools_approval_mode = "writes"`, adding Codex approval on top of the server's own mutation gates. [`.vscode/mcp.json`](.vscode/mcp.json) is also included.

## Safety model

Every mutation requires:

1. `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true` at startup.
2. `confirm: true` in the individual MCP call.

Additional safeguards:

- work item updates can test `expectedRevision`;
- branch deletion requires `expectedObjectId`;
- inline comments validate the current iteration, file side, line range, and `changeTrackingId`;
- PR completion requires the exact current source commit SHA;
- PR completion and auto-complete always use `bypassPolicy: false`;
- comment edits and deletes require exact work item or PR/thread/comment IDs, and Azure DevOps still enforces author and permission rules;
- mutation requests are never automatically retried;
- PATs, bearer tokens, and authorization headers never appear in tool or doctor output.

## Example prompts

```text
Read work item 544, including comments, relations, and delivery links.
Replace my English PR comment with this Turkish explanation after I confirm.
Delete my duplicate reply from thread 42 after I confirm the comment ID.
Move work item 544 to Project\Sprint 8 after I confirm.
Create a branch feature/544 at this exact commit after I confirm.
Review this Azure DevOps pull request URL and report merge blockers.
Add a required reviewer and enable squash auto-complete after I confirm.
Show failed builds for the hpower repository and retrieve the last run logs.
Run pipeline 12 on feature/544 with deploy=false after I confirm.
Show the current sprint capacity and calculated story-point velocity.
Report branches and active PRs older than 45 days.
```

## Validation

```powershell
npm run typecheck
npm run typecheck:tests
npm test
npm run build
npm run smoke:mcp
npm run doctor
npm pack --dry-run
```

`doctor` performs live read-only checks without printing credentials.

## Scope boundaries

This release does not manage wikis, test plans, service connections, variable groups, deployment environments, saved queries, repository creation, or Azure DevOps Server/on-premises. Pipeline rerun is full-run only.

## API references

The adapters target Microsoft's Azure DevOps REST API 7.1 documentation for [Git](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/?view=azure-devops-rest-7.1), [PR thread comments](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-thread-comments?view=azure-devops-rest-7.1), [Work Item Tracking](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/?view=azure-devops-rest-7.1), [work item comments](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments?view=azure-devops-rest-7.1), [Pipelines](https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/?view=azure-devops-rest-7.1), [Build](https://learn.microsoft.com/en-us/rest/api/azure/devops/build/?view=azure-devops-rest-7.1), and [Work/Sprints](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/?view=azure-devops-rest-7.1).

## License

MIT © 2026 Hasan Özcan. See [LICENSE](LICENSE).
