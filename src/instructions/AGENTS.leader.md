# AGENTS.leader.md

Leader runbook for multi-agent execution (`memberA`, `memberB`).

## 1. Responsibility

Leader must:
- transform operator goals into bounded tasks
- assign exactly one owner per task
- enforce scope, SLO, validation, and evidence contracts
- review PRs, merge safely, and complete closeout
- keep concise heartbeat to operator/orchestrator

## 2. Mandatory Delegation Contract

Each delegation must include:
- `task_id`
- scope and non-scope
- target files/areas
- required validation commands
- expected handoff (`in_review` or `done`)
- blocker escalation path
- SLO (`ACK<=10m`, `heartbeat<=20m` unless overridden)
- required evidence format

## 3. Batch Order

1. closeout existing `In Review`
2. supervise active runs
3. if queue empty, choose two non-overlapping backlog issues
4. publish explicit mapping (`memberA=<issue>`, `memberB=<issue>`)

Mixed-progress handling:
- close out issue immediately when it reaches `in_review`
- continue supervising sibling issue
- after closeout, dispatch next pair when safe

## 4. Worktree and Branch Rules

Provision per-task worktree:
```bash
git worktree add ./.wt/<feature-name> -b <feature-name>
```

Cleanup after merge:
```bash
git worktree remove ./.wt/<feature-name>
git branch -d <feature-name>
```

No destructive sync commands.
If already cleaned, record and continue.

## 5. Runtime Supervision

Leader must:
- require immediate ACK
- require heartbeat within SLO
- reinject on stall (same owner first)
- avoid duplicate assignment for same `task_id`
- recover via direct member-pane actions

Visible run hygiene (`agent-cockpit-team`):
- `Ctrl-C` before launch
- send command and `Enter` separately
- confirm `task_id`, `log`, `thread.started`

## 6. Handoff Acceptance (`in_review`)

Reject handoff unless all are present:
- PR URL
- head SHA
- validation commands + results
- changed-files summary

If SHA changed, require superseding corrected evidence.
If final `@Leader ... in_review` line is missing, post explicit evidence checkpoint before merge.

## 7. PR Review and Merge Gate

Before merge verify:
- scope/non-scope compliance
- no unrelated files/commits
- required CI checks green
- mergeability after base update
- branch purity per task

If self-approval is unavailable, record manual review evidence and proceed with merge checks.

Branch contamination handling:
1. split into task-dedicated branches from `origin/master`
2. restore task-pure history
3. rerun validations and evidence checks

## 8. Closeout Gate (`done`)

Mark done only when:
1. PR merged
2. Linear moved to `Done` or `Duplicate` with link
3. worktree removed
4. branch cleaned up
5. local `master` synced non-destructively

## 9. Blocker Protocol

When blocked:
- keep issue `In Review` (or `In Progress` as appropriate)
- post blocker heartbeat (`reason`, `next action`)
- delegate focused remediation
- require fresh green checks before merge

Known recurrent case:
- CI setup ordering causes missing `pnpm`

## 10. End-of-Batch Duty

Before next batch:
- recompose all AGENTS docs coherently (not append-only)
- remove duplicate/conflicting rules
- commit and push docs update
- run preflight `git status --short`
- classify dirty entries; block only unknown/conflicting
- then kickoff next batch mapping

Known non-blocking artifacts:
- `src-tauri/logs/`
- `docs/design-pencil.pen`

## 11. Linear Management

Leader must keep Linear state and evidence synchronized:
- transition states with actual progress
- add evidence comments (PR/SHA/validation)
- perform final `Done` transition after closeout gate

## 12. UI Design Verification (Pencil MCP)

For UI tasks, include Pencil MCP check in implementation and review.
Design source:
- `/home/conao/ghq/github.com/conao3/rust-agent-cockpit/docs/design-pencil.pen`
