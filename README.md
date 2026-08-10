# Azure DevOps MCP Server

Focused local MCP server for **Azure DevOps Services / Azure Repos**. It provides a review-oriented workflow while using Azure DevOps REST API 7.1.

The server is intentionally narrower than Microsoft's general-purpose Azure DevOps MCP server. Its primary use case is pull request investigation and review:

- repository, branch, pull request, commit, reviewer, and thread reads
- Azure Boards work item details, relations, WIQL queries, and pageable comments
- pull request iteration and changed-file inspection
- locally generated unified diffs and per-file statistics
- a single-call pull request review context bundle
- inline comment target validation against the current iteration
- guarded pull request comments, thread status updates, and reviewer votes

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
- Work Items: Read for work item details, WIQL queries, and comments
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

The server exposes 31 focused MCP tools. See [tool documentation](docs/tools.md).

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

- Azure Boards mutations, saved-query management, backlogs, or sprint administration
- pipelines, builds, wikis, test plans, or Advanced Security
- repository, branch, or PR creation
- PR completion, abandonment, or merge
- Azure DevOps Server/on-premises

Use Microsoft's official Azure DevOps MCP server when those broader domains are required.
