# AGENTS.leader.md

Leader runbook for multi-agent execution (`memberA`, `memberB`).

## A. Leader Mandate

- convert operator goals into bounded tasks
- assign single owner per task
- enforce contract, quality gates, and timing SLO
- review/merge and complete closeout
- keep operator heartbeat concise and frequent

## B. Mandatory Dispatch Contract

Each delegation must include:

- `task_id`
- scope and explicit non-scope
- target files/areas
- required validation commands
- expected handoff state (`in_review` or `done`)
- blocker escalation instruction
- SLO (`ACK<=10m`, `heartbeat<=20m`, unless overridden)
- evidence format (PR URL, SHA, validations, changed files)

## C. Batch Planning Order

1. closeout-first for existing `In Review`
2. then active implementation
3. if no active queue, choose two non-overlapping backlog issues

Always announce assignment mapping explicitly.

Mixed-progress rule:

- if one assigned issue reaches `in_review` before the other, run closeout immediately for that issue while keeping the other issue in active execution monitoring
- after closeout is finished, you may dispatch the next two non-overlapping issues in the same batch
- in the next batch, prioritize monitoring/recovery of already spawned runs before selecting new issues

## D. Worktree Rules

Provision per-task worktree:

```bash
git worktree add ./.wt/<feature-name> -b <feature-name>
```

Cleanup sequence after merge:

```bash
git worktree remove ./.wt/<feature-name>
git branch -d <feature-name>
```

## E. Runtime Monitoring

- require immediate ACK from each member
- require heartbeat by SLO window
- if timeout/stall: reinject in same member pane
- never dual-assign one `task_id`
- if supervision stalls, do not keep tailing your own run log as the main action; switch to direct member-pane recovery
- record per-member visible run `session_id` and ACK timestamp for operator/audit traceability

Visible run hygiene in `agent-cockpit-team`:

- `Ctrl-C` before launch
- one clean command
- confirm `task_id`, `log`, `thread.started`

## F. Handoff Acceptance (`in_review`)

Reject handoff unless all present:

- PR URL
- head SHA
- validations + results
- changed-files summary

If SHA changes after rewrite/rebase, require corrected evidence comment.
If prior evidence SHA was incorrect, require superseding correction.
If a member recovery run omits the final `@Leader ... in_review` line, create a Linear evidence checkpoint yourself (PR/SHA/validations/files) before merge/closeout.

## G. PR Review Gate

Before merge, verify:

- scope/non-scope compliance
- no unrelated files/commits (especially `src/instructions/*` unless explicitly requested)
- required CI checks green
- mergeability after base updates/conflict resolution

If self-approval is blocked, record manual review evidence and proceed with merge checks.

## H. Closeout Gate (`done`)

Done only when all pass:

1. PR merged
2. Linear updated to `Done`/`Duplicate`
3. worktree removed
4. branch cleanup completed
5. local `master` synced non-destructively

No destructive git sync commands.

## I. Blocker Protocol

When required checks fail:

- keep issue `In Review`
- post blocker heartbeat (cause + next action)
- delegate focused fix to owner
- require fresh evidence and green checks before merge

Known case:

- missing `pnpm` in CI workflow due setup ordering

## J. End-of-Batch Duty

Before starting next batch:

- recompose all three AGENTS docs coherently (not append-only)
- remove duplicate/conflicting statements
- commit doc update
- run preflight `git status --short` and explicitly decide handling for dirty files before dispatch
- start next batch with explicit mapping

## K. Design Verification (Pencil MCP)

- UI tasks should reference Pencil MCP for design checks.
- Primary design file: `/home/conao/ghq/github.com/conao3/rust-agent-cockpit/docs/design-pencil.pen`
- Include this file path in UI dispatch contracts and review checklists.

Preflight decision guide:

- treat known operator/runtime untracked files (e.g. `docs/design-pencil.pen`, `src-tauri/logs/`) as non-blocking
- halt only when dirty entries are unknown or conflict with current task scope
