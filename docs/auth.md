# Authentication

The server supports PAT and Azure CLI authentication through a common provider interface.

## PAT mode

```text
AZURE_DEVOPS_AUTH_MODE=pat
AZURE_DEVOPS_PAT=your-token
```

Requests use Azure DevOps Basic authentication with an empty username and the PAT as the password. The token is created once as an authorization header value and is never returned by an MCP tool.

Suggested permissions:

| Scenario | PAT permission |
| --- | --- |
| Repositories, branches, commits, PR metadata, diffs | Code: Read |
| Linked work item details | Work Items: Read |
| PR comments, thread status, reviewer vote | Code: Read & write |

Use the shortest practical token expiration and keep `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=false` for read-only installations.

## Azure CLI mode

Run:

```powershell
az login
```

Then configure:

```text
AZURE_DEVOPS_AUTH_MODE=azcli
AZURE_DEVOPS_PAT=
```

The server uses `AzureCliCredential` with the Azure DevOps resource scope `499b84ac-1321-427f-aa17-267ca6975798/.default`. Access tokens are cached in memory and refreshed five minutes before expiry.

## Setup and diagnosis

Interactive setup:

```powershell
npm run setup
```

Skip the live access check only when preparing configuration offline:

```powershell
npm run setup -- --skip-validation
```

Verify saved credentials:

```powershell
npm run doctor
```

Doctor output is deliberately limited to non-secret runtime information.

## Common failures

| Result | Likely cause |
| --- | --- |
| HTTP 401 | Missing, expired, revoked, or malformed PAT/token |
| HTTP 403 | Authenticated identity lacks project/repository permission or required PAT scope |
| HTTP 404 | Resource is missing or Azure DevOps is concealing it because access is denied |
| Azure CLI credential error | `az login` has not been run for the intended tenant/account |
| Inline validation failure | File/line is not present in the selected PR iteration or the source branch was updated |
