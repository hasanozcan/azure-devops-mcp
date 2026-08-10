# MCP Tools

All successful calls return JSON text plus `structuredContent`. Azure DevOps HTTP failures are normalized into an `error` object when possible.

## Core and repository tools

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `check_azure_devops_auth` | Verify authentication and optional project access | optional `project` |
| `list_projects` | List organization projects | optional `top`, `continuationToken`, `stateFilter` |
| `list_repositories` | List Git repositories | optional `project` |
| `get_repository` | Get repository metadata | `repositoryId`, optional `project` |
| `get_clone_links` | Get HTTPS, SSH, and web URLs | `repositoryId`, optional `project` |
| `list_branches` | List/filter repository branches | `repositoryId`, optional `project`, `filter`, `top`, `continuationToken` |

## Azure Boards work item tools

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `get_work_item` | Get one work item with all fields and relations by default | `workItemId`, optional `project`, `fields`, `asOf`, `expand` |
| `query_work_items` | Run read-only WIQL and resolve matching item details | `wiql`, optional `project`, `top`, `timePrecision`, `fields` |
| `get_work_item_comments` | List pageable comments for one work item | `workItemId`, optional `project`, paging, expansion, sort order |

## Pull request and history tools

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `list_pull_requests` | List PRs by repository or project | optional `repositoryId`, `status`, refs, creator/reviewer, paging |
| `get_pull_request` | Get one PR | `repositoryId`, `pullRequestId` |
| `get_pull_request_by_url` | Parse and retrieve a PR web URL | `url` |
| `get_pull_request_commits` | List PR commits | `repositoryId`, `pullRequestId`, optional paging |
| `list_commits` | List repository commits | `repositoryId`, optional revision/date/author filters |
| `get_pull_request_threads` | List comment threads | `repositoryId`, `pullRequestId`, optional iteration/paging |
| `get_pull_request_thread_comments` | List comments inside one thread | `repositoryId`, `pullRequestId`, `threadId` |
| `get_pull_request_work_items` | Resolve directly linked work items | `repositoryId`, `pullRequestId` |
| `get_pull_request_iterations` | List PR push iterations | `repositoryId`, `pullRequestId` |
| `get_pull_request_reviewers` | List reviewers and votes | `repositoryId`, `pullRequestId` |

## Review tools

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `get_pull_request_changed_files` | Changed files and per-file stats | `repositoryId`, `pullRequestId`, optional `iterationId`, `maxFiles` |
| `get_pull_request_diff_stats` | Aggregate stats and largest files | `repositoryId`, `pullRequestId`, optional limits |
| `get_pull_request_diff` | Locally generated unified PR diff | `repositoryId`, `pullRequestId`, optional iteration/file/line limits |
| `get_pull_request_file_diff` | Unified diff for one file | `repositoryId`, `pullRequestId`, `path` |
| `validate_inline_comment_target` | Validate path, side, range, iteration, and tracking ID | `repositoryId`, `pullRequestId`, `path`, `fromLine` or `toLine` |
| `get_pull_request_review_context` | PR, changed files, diff, commits, threads, reviewers, work items | `repositoryId`, `pullRequestId`, optional include flags |

## Mutation tools

Every mutation requires `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true` and `confirm: true`.

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `create_pull_request_comment` | Create top-level PR thread | `repositoryId`, `pullRequestId`, `content`, `confirm` |
| `create_pull_request_inline_comment` | Validate and create inline thread | PR target, `content`, `path`, line side/range, `confirm` |
| `reply_to_pull_request_thread` | Reply in an existing thread | PR target, `threadId`, optional `parentCommentId`, `content`, `confirm` |
| `update_pull_request_thread_status` | Set `active`, `fixed`, `wontFix`, `closed`, `byDesign`, or `pending` | PR target, `threadId`, `status`, `confirm` |
| `set_pull_request_vote` | Cast authenticated user's review vote | PR target, `vote`, `confirm` |
| `request_pull_request_changes` | Compatibility action for `waitForAuthor` | PR target, `confirm` |

Vote mapping:

| Input | Azure DevOps value |
| --- | ---: |
| `approve` | `10` |
| `approveWithSuggestions` | `5` |
| `noVote` | `0` |
| `waitForAuthor` | `-5` |
| `reject` | `-10` |

## Recommended review flow

1. Call `get_pull_request_by_url` or `get_pull_request`.
2. Call `get_pull_request_review_context` for the first pass.
3. Use `get_pull_request_diff_stats` and `get_pull_request_file_diff` for large reviews.
4. Call `validate_inline_comment_target` before proposing an inline comment.
5. After explicit user approval, call `create_pull_request_inline_comment` with `confirm: true`.
6. After all actionable feedback is posted, use `request_pull_request_changes` or `set_pull_request_vote` only with explicit approval.
