# Azure DevOps MCP Server

Focused local MCP server for **Azure DevOps Services, Azure Repos, and Azure Boards**. It provides ticket and pull-request workflows through 34 MCP tools backed by Azure DevOps REST API 7.1.

The server is intentionally narrower than Microsoft's general-purpose Azure DevOps MCP server. It focuses on the day-to-day workflow around work items, repositories, and pull requests.

## What it can do

### Azure Boards work items

- Get any work item by ID with all available fields by default, including Description and Acceptance Criteria when present.
- Return work item metadata, links, parent/child relationships, and other relations.
- Run read-only WIQL `SELECT` queries for open, assigned, recently changed, or otherwise filtered work items.
- Resolve WIQL matches into useful work item summaries; queries return at most 100 items by default and 1,000 when explicitly requested.
- Request custom Azure Boards fields when a smaller or specialized result is needed.
- Read work item comments with paging, sort order, deleted-comment filtering, rendered text, and reactions.
- Add Markdown or HTML comments to work items through a guarded write tool.
- Resolve work items directly linked to a pull request.

Example prompts:

```text
Get work item 12345 with all fields, relations, and comments.
List the open bugs assigned to me in the current project.
Show the 20 most recently changed User Stories.
Find active work items tagged production.
Add a comment to work item 544 after I confirm the exact text.
```

### Projects, repositories, branches, and commits

- Verify authentication and project access without exposing credentials.
- List projects and repositories.
- Get repository metadata and HTTPS, SSH, and web clone links.
- List and filter branches.
- List repository commits by branch, tag, commit, date range, or author.

Example prompts:

```text
List repositories in the default project.
Show branches in the hpower repository.
List commits on the develop branch from the last seven days.
```

### Pull request investigation and review

- List and filter pull requests by repository, status, source/target branch, creator, or reviewer.
- Retrieve a pull request by project/repository/ID or parse an Azure DevOps PR URL directly.
- Read PR commits, reviewers and votes, iterations, threads, comments, and linked work items.
- Inspect changed files and aggregate additions/deletions.
- Generate bounded unified diffs locally for the whole PR or one file.
- Build a single review-context bundle containing PR metadata, diff, commits, threads, reviewers, and work items.
- Validate an inline-comment target against the latest iteration and Azure DevOps `changeTrackingId` before writing.

Example prompts:

```text
Review this Azure DevOps pull request URL.
Show changed files and diff statistics for PR 123.
Get the complete review context for PR 123 in repository hpower.
Validate line 42 in src/app.ts as an inline-comment target.
```

### Guarded writes

When write tools are explicitly enabled, the server can:

- Add Markdown or HTML comments to Azure Boards work items.
- Create same-repository pull requests with optional draft status, reviewers, linked work items, and iteration support.
- Complete active pull requests with an explicit merge strategy, reviewed source-commit pinning, and no policy bypass.
- Create top-level PR comments.
- Create validated inline comments.
- Reply to an existing discussion thread.
- Update a thread to active, fixed, won't-fix, closed, by-design, or pending.
- Approve, approve with suggestions, clear a vote, wait for author, or reject.
- Request pull request changes through the wait-for-author vote.

Every write requires both `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true` and `confirm=true`. Inline comments require an additional target-validation pass.

Example prompt:

```text
Create a draft PR in hpower from feature/ticket-544 to develop, link work item 544, and ask for confirmation before submitting it.
Read PR 77 again, show me its current source commit and merge strategy options, then complete it only after I confirm.
```

### Tool groups

| Group | Count | Coverage |
| --- | ---: | --- |
| Core and repositories | 6 | Auth, projects, repositories, clone links, branches |
| Azure Boards | 3 | Work item details, WIQL queries, comments |
| Pull requests and history | 10 | PR metadata, commits, threads, work items, iterations, reviewers |
| Review and diff | 6 | Changed files, stats, unified diffs, inline validation, review context |
| Guarded writes | 9 | PR creation/completion, work item/PR comments, replies, thread state, votes, request changes |
| **Total** | **34** | |

## Requirements

- Node.js 20+
- npm
- An Azure DevOps Services organization
- One of:
  - an Azure DevOps Personal Access Token (PAT)
  - Azure CLI signed in with `az login`

Azure DevOps Server/on-premises is not currently supported.

## Quick start

```powershell
git clone https://github.com/hasanozcan/azure-devops-mcp.git
cd azure-devops-mcp
npm install
npm run setup
npm run build
npm run doctor
```

Start the server directly:

```powershell
npm start
```

Development mode:

```powershell
npm run dev
```

The MCP transport is local `stdio`; stdout is reserved for MCP protocol messages.

## Authentication

### PAT

Set:

```text
AZURE_DEVOPS_AUTH_MODE=pat
AZURE_DEVOPS_PAT=your-token
```

Recommended PAT permissions:

- Code: Read for read-only repository and PR tools
- Work Items: Read for work item details, WIQL queries, and reading comments
- Work Items: Read & write when work item comment creation is enabled
- Code: Read & write when comment, thread, or vote tools are enabled

Keep write tools disabled unless needed.

### Azure CLI

```powershell
az login
```

Then configure:

```text
AZURE_DEVOPS_AUTH_MODE=azcli
AZURE_DEVOPS_PAT=
```

The server requests an Azure DevOps token through `AzureCliCredential` and refreshes it before expiry.

See [authentication documentation](docs/auth.md).

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AZURE_DEVOPS_ORGANIZATION` | Yes | None | Organization name or Azure DevOps URL |
| `AZURE_DEVOPS_DEFAULT_PROJECT` | No | None | Project used when a tool omits `project` |
| `AZURE_DEVOPS_AUTH_MODE` | No | `pat` | `pat` or `azcli` |
| `AZURE_DEVOPS_PAT` | PAT mode | None | Personal Access Token |
| `AZURE_DEVOPS_BASE_URL` | No | `https://dev.azure.com` | REST API base URL |
| `AZURE_DEVOPS_API_VERSION` | No | `7.1` | REST API version |
| `AZURE_DEVOPS_ENABLE_WRITE_TOOLS` | No | `false` | Enable guarded mutations |
| `AZURE_DEVOPS_REQUEST_TIMEOUT_MS` | No | `30000` | Per-request timeout |
| `AZURE_DEVOPS_RETRY_COUNT` | No | `2` | Retry count for retryable reads |
| `AZURE_DEVOPS_MAX_DIFF_FILE_BYTES` | No | `1048576` | Per-side file size limit for local diff generation |
| `AZURE_DEVOPS_MAX_DIFF_LINES` | No | `5000` | Maximum diff lines returned by a tool call |

Placeholder secrets such as `replace-me` are rejected at startup.

## Codex configuration

The project includes [`.codex/config.toml`](.codex/config.toml). Build the project, create `.env`, trust/open this project in Codex, and restart the MCP server list.

You can also register it from a terminal:

```powershell
codex mcp add azure-devops-mcp -- node "<absolute-path-to-project>\dist\server.js"
```

The project-scoped configuration uses `default_tools_approval_mode = "writes"`, so mutation tools receive an additional Codex approval boundary. The server itself still independently requires `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true` and `confirm=true`.

For VS Code, [`.vscode/mcp.json`](.vscode/mcp.json) is included.

## Safety model

Every mutation is protected twice:

1. `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true` must be set at server startup.
2. The individual MCP call must contain `confirm: true`.

Inline comments add a third check: the path, side, line range, latest iteration, and Azure DevOps `changeTrackingId` are validated before the POST request.

PR completion adds a third check: the exact reviewed source commit SHA must still match the current PR source. Policy bypass is not exposed.

PATs, bearer tokens, and authorization headers are never included in tool or doctor output.

## Diff behavior

Azure DevOps exposes PR iteration changes rather than a complete unified patch. This server:

1. resolves the latest PR iteration and common/source commits;
2. retrieves the changed-file list and `changeTrackingId` values;
3. downloads each file at the base and source commits;
4. generates unified patches locally;
5. applies file-size, binary, file-count, and output-line limits.

Diff bundles are cached in memory for two minutes. Binary and oversized files remain visible in file summaries but do not return patch text.

## Tools

The server exposes 34 focused MCP tools. See [tool documentation](docs/tools.md).

## Validation

```powershell
npm run typecheck
npm run typecheck:tests
npm test
npm run build
npm run doctor
```

`doctor` makes live read-only calls and prints identity/project/repository access information without printing credentials.

## Packaging

The package is configured for public publication under the MIT license:

```powershell
npm pack --dry-run
npm publish
```

The npm package name is `azure-devops-pr-mcp`.

## License

MIT © 2026 Hasan Özcan. See [LICENSE](LICENSE).

## Scope

Not included in the first release:

- other Azure Boards mutations such as field/state updates, saved-query management, backlogs, or sprint administration
- pipelines, builds, wikis, test plans, or Advanced Security
- repository or branch creation
- PR abandonment
- Azure DevOps Server/on-premises

Use Microsoft's official Azure DevOps MCP server when those broader domains are required.
