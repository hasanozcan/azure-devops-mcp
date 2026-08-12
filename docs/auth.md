# Authentication and Permissions

The server supports PAT and Azure CLI authentication through a common provider interface.

## PAT mode

```dotenv
AZURE_DEVOPS_AUTH_MODE=pat
AZURE_DEVOPS_PAT=your-token
```

Requests use Azure DevOps Basic authentication with an empty username and the PAT as the password. The authorization value is never returned by an MCP tool.

### Suggested PAT permissions

| Scenario | PAT permission |
| --- | --- |
| Repositories, branches, commits, PR metadata, diffs, labels, policies | Code: Read |
| PR creation/update/completion, comment create/edit/delete, votes, reviewers, labels, branch create/delete | Code: Read & write |
| Work items, WIQL, comments, relations, updates, and sprint work items | Work Items: Read |
| Work item creation/update, comment create/edit/delete, relations, attachments, and backlog reorder | Work Items: Read & write |
| Pipeline definitions, runs, builds, and logs | Build: Read |
| Pipeline queue, preview, and full rerun | Build: Read & execute |
| Team iteration and capacity metadata | Project and Team: Read |

PAT labels can vary slightly in the Azure DevOps UI. Start with the smallest scopes needed, use the shortest practical expiration, and keep `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=false` on read-only installations.

## Azure CLI mode

```powershell
az login
```

```dotenv
AZURE_DEVOPS_AUTH_MODE=azcli
AZURE_DEVOPS_PAT=
```

The server uses `AzureCliCredential` with Azure DevOps resource scope `499b84ac-1321-427f-aa17-267ca6975798/.default`. Tokens are cached only in memory and refreshed five minutes before expiry.

The signed-in Azure identity must have the corresponding organization, project, repository, Boards, and Pipeline permissions. Azure CLI authentication does not bypass Azure DevOps authorization.

## Write activation

Authentication permission alone is insufficient for mutation tools. Set:

```dotenv
AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true
```

Each mutation call must still include `confirm: true`. Codex project configuration additionally requests approval for write tools.

## Setup and diagnosis

Interactive setup:

```powershell
npm run setup
```

Prepare configuration without a live access check:

```powershell
npm run setup -- --skip-validation
```

Verify saved credentials with read-only calls:

```powershell
npm run doctor
```

Doctor output is limited to non-secret identity, organization, project, and repository access information.

## Common failures

| Result | Likely cause |
| --- | --- |
| HTTP 401 | Missing, expired, revoked, or malformed PAT/token |
| HTTP 403 on Git/PR | Missing Code permission or repository/project access |
| HTTP 403 on Boards | Missing Work Items scope or area-path permission |
| HTTP 403 on Pipelines | Missing Build scope, pipeline permission, or queue permission |
| HTTP 404 | Resource is missing or Azure DevOps conceals it because access is denied |
| Azure CLI credential error | `az login` was not run for the intended tenant/account |
| Work item revision conflict | `expectedRevision` no longer matches; re-read before writing |
| Branch update rejected | Source/expected object ID does not match current ref state |
| Inline validation failure | File/line is absent from the current PR iteration |
| Merge rejected | Branch policies or current source SHA prevent completion |
| Comment edit/delete rejected | The identity is not the author or lacks the required thread/work-item permission |

Never commit `.env`; it is ignored by Git. Rotate a PAT immediately if it is exposed in a terminal transcript, issue, PR, or chat.
