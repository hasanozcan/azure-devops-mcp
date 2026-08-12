# MCP Tool Reference

All successful calls return JSON text and `structuredContent`. Azure DevOps HTTP failures are normalized into an `error` object when possible. Optional `project` inputs use `AZURE_DEVOPS_DEFAULT_PROJECT`.

Every mutation in this document requires `AZURE_DEVOPS_ENABLE_WRITE_TOOLS=true` and `confirm: true`.

## Core and repositories (6)

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `check_azure_devops_auth` | Verify identity and optional project access without exposing credentials | optional `project` |
| `list_projects` | List organization projects | optional paging and state filter |
| `list_repositories` | List Git repositories | optional `project` |
| `get_repository` | Get repository metadata | `repositoryId` |
| `get_clone_links` | Get HTTPS, SSH, and web URLs | `repositoryId` |
| `list_branches` | List/filter repository branches | `repositoryId`, optional filter/paging |

## Azure Boards (10)

| Tool | Mode | Purpose | Main inputs |
| --- | --- | --- | --- |
| `get_work_item` | Read | Get fields, links, relations, or an `asOf` snapshot | `workItemId`, optional `fields`, `expand`, `asOf` |
| `query_work_items` | Read | Run WIQL `SELECT` and resolve matching items | `wiql`, optional `top`, `fields` |
| `get_work_item_comments` | Read | List pageable comments | `workItemId`, paging/expand/order options |
| `add_work_item_comment` | Write | Add Markdown or HTML comment | `workItemId`, `text`, optional `format`, `confirm` |
| `update_work_item_comment` | Write | Replace an existing comment's text | `workItemId`, `commentId`, `text`, `confirm` |
| `delete_work_item_comment` | Write | Soft-delete an existing comment | `workItemId`, `commentId`, `confirm` |
| `create_work_item` | Write | Create User Story, Bug, Task, Epic, or process-defined type | `workItemType`, `title`, standard/custom fields, `confirm` |
| `update_work_item` | Write | Change state, assignee, tags, sprint, area, or arbitrary fields | `workItemId`, changes, optional `expectedRevision`, `confirm` |
| `add_work_item_relation` | Write | Add parent/child/related/dependency/duplicate relation | source/target IDs, `relation`, `confirm` |
| `add_work_item_attachment` | Write | Upload and link base64 file up to 10 MiB | `workItemId`, `fileName`, `contentBase64`, `confirm` |

`create_work_item` and `update_work_item` support `validateOnly`. `update_work_item` can move a ticket to a sprint through `iterationPath` or `fields["System.IterationPath"]`.

## Pull request reads and history (10)

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `list_pull_requests` | List PRs by repository/project and search criteria | optional repository, status, refs, creator/reviewer, paging |
| `get_pull_request` | Get one PR | `repositoryId`, `pullRequestId` |
| `get_pull_request_by_url` | Parse and retrieve a PR web URL | `url` |
| `get_pull_request_commits` | List PR commits | PR target, optional paging |
| `list_commits` | List repository commits | repository, optional revision/date/author filters |
| `get_pull_request_threads` | List review threads | PR target, optional iteration/paging |
| `get_pull_request_thread_comments` | List comments in one thread | PR target, `threadId` |
| `get_pull_request_work_items` | Resolve linked work items | PR target |
| `get_pull_request_iterations` | List PR push iterations | PR target |
| `get_pull_request_reviewers` | List reviewers and votes | PR target |

## Review and diff (6)

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `get_pull_request_changed_files` | Changed files and per-file stats | PR target, optional iteration/limit |
| `get_pull_request_diff_stats` | Aggregate statistics and largest files | PR target, optional limits |
| `get_pull_request_diff` | Locally generated bounded unified diff | PR target, optional file/line limits |
| `get_pull_request_file_diff` | Unified diff for one path | PR target, `path` |
| `validate_inline_comment_target` | Validate side/range/iteration/tracking ID | PR target, `path`, line inputs |
| `get_pull_request_review_context` | Bundle PR, diff, commits, threads, reviewers, and work items | PR target, optional include flags |

## PR review and lifecycle writes (15)

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `create_pull_request` | Create same-repository PR with optional draft/reviewers/work items | source/target/title options, `confirm` |
| `complete_pull_request` | Merge active non-draft PR at exact source SHA | PR target, `expectedSourceCommitId`, strategy, `confirm` |
| `update_pull_request` | Edit title/description/draft or abandon/reactivate | PR target, changes, `confirm` |
| `set_pull_request_auto_complete` | Enable/disable policy-respecting auto-complete | PR target, `enabled`, optional strategy, `confirm` |
| `create_pull_request_comment` | Create top-level thread | PR target, `content`, `confirm` |
| `create_pull_request_inline_comment` | Validate and create inline comment | PR target, content/path/lines, `confirm` |
| `reply_to_pull_request_thread` | Reply inside a thread | PR target, `threadId`, `content`, `confirm` |
| `update_pull_request_comment` | Replace a top-level or reply comment's content | PR target, `threadId`, `commentId`, `content`, `confirm` |
| `delete_pull_request_comment` | Soft-delete a top-level or reply comment | PR target, `threadId`, `commentId`, `confirm` |
| `update_pull_request_thread_status` | Resolve/reactivate/close thread | PR target, `threadId`, `status`, `confirm` |
| `set_pull_request_vote` | Set current user's vote | PR target, `vote`, `confirm` |
| `request_pull_request_changes` | Set current user to wait-for-author | PR target, `confirm` |
| `manage_pull_request_reviewer` | Add/remove reviewer and optional required flag | PR target, action, reviewer ID, `confirm` |
| `list_pull_request_labels` | List PR labels | PR target |
| `manage_pull_request_label` | Add/remove PR label | PR target, action, label, `confirm` |

Merge strategies are `noFastForward`, `squash`, `rebase`, and `rebaseMerge`. `complete_pull_request` re-reads the PR and refuses a changed source SHA. Completion and auto-complete always send `bypassPolicy: false`.

Vote values: `approve` = 10, `approveWithSuggestions` = 5, `noVote` = 0, `waitForAuthor` = -5, `reject` = -10.

Comment updates and deletes require the exact comment IDs. Azure DevOps enforces whether the authenticated identity may edit or delete that comment; the MCP server does not bypass author or repository permissions. Deleting every comment in a PR thread may cause Azure DevOps to mark the thread deleted.

## Branch lifecycle (4)

| Tool | Mode | Purpose | Main inputs |
| --- | --- | --- | --- |
| `create_branch` | Write | Create branch at exact Git object | repository, branch, `sourceObjectId`, `confirm` |
| `delete_branch` | Write | Delete only at expected object ID | repository, branch, `expectedObjectId`, `confirm` |
| `compare_branches` | Read | Ahead/behind/common commit and changes | repository, base/target branches, optional `top` |
| `list_stale_branches` | Read | Find branches older than threshold | repository, optional days/limit/protected names |

## Pipelines and builds (7)

| Tool | Mode | Purpose | Main inputs |
| --- | --- | --- | --- |
| `list_pipelines` | Read | List pipeline definitions | optional paging/order |
| `list_pipeline_runs` | Read | List runs for a pipeline | `pipelineId`, optional paging |
| `get_pipeline_run` | Read | Get run state/result/resources | `pipelineId`, `runId` |
| `run_pipeline` | Write | Queue or preview with branch/variables/parameters/skipped stages | `pipelineId`, options, `confirm` |
| `rerun_pipeline` | Write | Queue a full run from previous resolved resources | `pipelineId`, `runId`, `confirm` |
| `get_pipeline_run_logs` | Read | List log records or fetch bounded text | `runId`, optional `logId`, `maxChars` |
| `list_builds` | Read | Filter build records | definition/repository/branch/status/result/paging |

`rerun_pipeline` is a full pipeline rerun, not a failed-job-only retry. Secret pipeline variables are not returned by Azure DevOps and should not be placed in prompts.

## Sprints and backlogs (5)

| Tool | Mode | Purpose | Main inputs |
| --- | --- | --- | --- |
| `list_team_iterations` | Read | List all/current/past/future team iterations | optional team/timeframe |
| `get_iteration_work_items` | Read | Resolve sprint work items | optional team, `iterationId` |
| `get_team_capacity` | Read | Read member activities/capacity/days off | optional team, `iterationId` |
| `get_iteration_velocity` | Read | Calculate item and point completion | iteration, optional points field/completed states |
| `reorder_backlog_work_items` | Write | Reorder/reparent/move backlog items | IDs, adjacency/parent/iteration options, `confirm` |

Velocity defaults to `Microsoft.VSTS.Scheduling.StoryPoints` and completed states `Done`, `Closed`, and `Completed`.

## Quality and delivery reports (5)

| Tool | Purpose | Main inputs |
| --- | --- | --- |
| `get_pull_request_merge_readiness` | Combine PR state, votes, threads, policies, and status checks | PR target |
| `get_batch_pull_request_review_summary` | Summarize votes and active threads across up to 50 PRs | optional repository/status/top |
| `get_stale_repository_report` | Combine stale branches and active PRs | repository, optional days/limit/protected names |
| `get_work_item_delivery_trace` | Categorize ticket links to PRs, commits, builds, refs, work items | `workItemId` |
| `get_work_item_audit_history` | List revision field/relation updates | `workItemId`, optional top/skip |

Merge readiness is an advisory read. Azure DevOps remains the source of truth and re-evaluates policies during completion.

## Recommended delivery flow

1. Read the ticket with `get_work_item` and `get_work_item_delivery_trace`.
2. Create or inspect the branch; use `compare_branches` before opening a PR.
3. Create the PR and read `get_pull_request_review_context`.
4. Validate inline targets before posting comments; use comment update/delete tools instead of adding correction replies when the authenticated identity has permission.
5. Use `get_pull_request_merge_readiness` and inspect failed build logs.
6. Re-read the PR source SHA immediately before `complete_pull_request`, or use policy-respecting auto-complete.
7. Confirm linked ticket/build state through delivery trace and audit history.
