# AGENTS.orchestrator.md

Backend orchestration policy for agent-cockpit.

## 1. Mission

Operate task execution as isolated, auditable runs.

- Orchestrator owns routing, state, retry, reconciliation, and evidence logging.
- Leader owns engineering judgment, merge decision, and completion judgment.
- Members own implementation in assigned worktrees.

## 2. Run Unit

Each run is identified by `task_id` and has:

- one owner (`MemberA` or `MemberB`)
- one workspace (`./.wt/<feature-name>`)
- monotonic status (`queued -> sent -> acknowledged -> in_progress -> in_review -> done`, plus `failed`)
- evidence bundle (PR, SHA, validations, changed files, CI, Linear link)

No completion inference from partial signals. Final handoff line is required.

## 3. Routing Rules

Accepted prefixes:

- `@MemberA: ...`
- `@MemberB: ...`
- `@AllMembers: ...` (explicit broadcast only)

If recipient is ambiguous or missing, reject:

```text
@Orchestrator: Invalid recipient. Use @MemberA:, @MemberB:, or explicit @AllMembers:.
```

No implicit broadcast and no recipient inference.

## 4. Required Metadata Envelope

Every dispatch record must include:

- `message_id` (UUID)
- `task_id`
- `from=Leader`
- `to=MemberA|MemberB`
- `attempt` (0-based)
- `workspace`
- `dedupe_key`
- `timestamp`
- `status`

## 5. Delivery and ACK

1. Deliver to one target pane unless explicit broadcast.
2. Send text and submit action separately.
3. Enforce task ownership lock (`task_id -> owner_member`).
4. Wait for ACK within contract SLO (default ACK <= 10m).
5. If ACK timeout, re-inject in same member pane immediately.
6. Retry with bounded attempts + exponential backoff.
7. Reassignment requires explicit Leader override.

## 6. Visibility and Startup Validation

For operator-visible runs in `agent-cockpit-team`:

- sanitize pane input first (`Ctrl-C`)
- send one clean command
- declare start only after `task_id`, `log:`, and `thread.started` are observed
- enforce heartbeat SLO (default <= 20m)

Preferred launcher:

```bash
./scripts/codex_exec_visible.sh <task-id> "<prompt>"
```

## 7. Dedupe, Concurrency, Reconciliation

- suppress duplicate active dispatches by `dedupe_key`
- only one active run per `(task_id, member)`
- bounded concurrency with queueing
- poll-based reconciliation cancels ineligible runs (`Done`, `Duplicate`, canceled)

## 8. Evidence Acceptance Rules

`in_review` is accepted only when handoff includes all:

- PR URL
- head SHA
- validations + results
- changed-files summary

If branch rewrite/rebase changes SHA, require refreshed evidence comment.
If an evidence SHA was wrong, require superseding corrected evidence before closeout.

## 9. Closeout Gate

A task becomes `done` only when all are true:

1. PR merged
2. Linear moved to `Done` (or `Duplicate` with link)
3. worktree removed
4. feature branches cleaned (local/remote as applicable)
5. local `master` synced non-destructively

Safety:

- never use destructive reset in closeout flow
- never remove worktree for unmerged PR
- never delete branch before attached worktree removal

## 10. CI Blocker Policy

If required checks are pending/failing:

- keep issue in `In Review`
- emit blocker heartbeat
- dispatch focused fix to owner
- require fresh green required checks before merge

Known failure pattern:

- GitHub Actions `Unable to locate executable file: pnpm`
- common fix: ensure `pnpm/action-setup` is executed before Node setup/cache usage

## 11. Batch Policy

Before next batch launch:

1. apply closeout-first for current `In Review` issues
2. if none, select next actionable work
3. if `Todo/In Progress` empty, pick from `Backlog` with non-overlapping domains
4. publish explicit mapping (`memberA=<issue> memberB=<issue>`)
5. update orchestrator/leader/member docs with distilled lessons

## 12. Audit Log Fields

Log at least:

- recipient parse result
- pane target
- `message_id`, `task_id`, `attempt`
- dedupe hit/miss
- ownership lock actions
- retry count
- workspace path
- status transitions
- evidence links (PR/CI/Linear comment IDs)
