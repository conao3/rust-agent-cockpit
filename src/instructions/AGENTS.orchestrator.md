# Orchestrator Instructions (agent-cockpit backend)

This document defines backend orchestration policy. The orchestrator routes and monitors runs; it does not implement feature code.

## Responsibility Boundary

- Orchestrator owns routing, run state, retries, and audit trail.
- Leader owns technical judgment, PR review, merge, and final completion decision.
- Members own implementation in assigned worktrees.

## Core Model (Symphony-style)

Treat each task as an isolated run.

- One run has one `task_id`, one owner, one workspace, one active status.
- Runtime truth is state-driven, not inferred from chat fragments.
- A run can end at `in_review`; `done` is closeout-complete.
- Every run must leave auditable evidence (PR, CI, validation, merge/cleanup metadata).

## Routing Contract

Accepted prefixes:

- `@MemberA: <message>`
- `@MemberB: <message>`
- `@AllMembers: <message>` (explicit broadcast only)

If missing/ambiguous recipient, reject and return:

```text
@Orchestrator: Invalid recipient. Use @MemberA:, @MemberB:, or explicit @AllMembers:.
```

No implicit recipient inference and no implicit broadcast.

## Run Envelope (required metadata)

Each dispatch must have:

- `message_id` (UUID)
- `task_id` (e.g. `CON-98`)
- `from` (`Leader`)
- `to` (`MemberA|MemberB`)
- `attempt` (0-based)
- `workspace` (e.g. `./.wt/con-98-ci-cache`)
- `dedupe_key` (`task_id + to + normalized_message_hash`)
- `status` (`queued|sent|acknowledged|in_progress|in_review|done|failed`)
- `timestamp`

## State Machine and Transitions

Per `(task_id, member)`:

- `queued -> sent -> acknowledged -> in_progress -> in_review -> done`
- `* -> failed` when retry budget is exhausted

Rules:

- Transitions are monotonic.
- Ignore stale/out-of-order events.
- Completion is explicit only: require final one-line `@Leader:` handoff.
- Process exit without final handoff is `failed_needs_resume`.

## Dispatch and ACK Rules

1. Route to exactly one member unless `@AllMembers`.
2. Enforce task ownership lock (`task_id -> owner_member`).
3. Deliver to tmux with text and submit key as separate actions.
4. Wait for ACK within contract window.
5. If ACK timeout: immediate pane-run reinjection to the same owner.
6. Retry with bounded attempts and exponential backoff.

Reassignment requires explicit override in Leader message (e.g. `[REASSIGN CON-98]`).

## Visibility and Execution

When operator expects visibility:

- Run in `agent-cockpit-team` panes, not detached background-only.
- Before launching, sanitize pane input (`Ctrl-C`) and send one clean command.
- Start is valid only after `task_id`, `log`, and `thread.started` appear.
- Track heartbeat cadence from contract (default ACK <= 10m, heartbeat <= 20m).
- If no heartbeat/liveness, mark stalled and trigger resume policy.

Preferred visible runner:

```bash
./scripts/codex_exec_visible.sh <task-id> "<prompt>"
```

Logs are expected at:

```text
logs/codex/<task-id>/<timestamp>.jsonl
```

## De-duplication and Concurrency

- Suppress duplicate active assignment for same `dedupe_key`.
- Keep only one active run per `(task_id, member)`.
- Apply bounded concurrency; queue overflow tasks.
- On each poll, reconcile tracker state and cancel ineligible runs (done/duplicate/canceled).

## Quality Gates Before `in_review` Acceptance

Orchestrator must not mark/report `in_review` without all evidence fields:

- PR URL
- final head commit SHA
- validation commands and results
- changed-files summary

If branch rewrite/rebase changes SHA, require refreshed evidence comment.

## Closeout Policy

Closeout-complete only when all pass:

1. PR merged.
2. Linear moved to `Done` (or `Duplicate` with linkage).
3. Worktree removed.
4. Local/remote feature branches cleaned (as applicable).
5. Local `master` synced non-destructively.

Safety:

- Never force reset user history.
- Do not remove worktree for unmerged PR.
- Do not delete branch before removing attached worktree.

If required CI is pending/failing, keep issue in `In Review` and emit blocker heartbeat.

## PR/CI Blocker Handling

- If required checks fail after workflow edits, keep closeout blocked.
- Example known failure: missing `pnpm` in GitHub Actions after cache optimization.
- Route a focused fix run to owning member, then require fresh green checks before merge.

## Batch Discipline

At the end of every batch, update orchestrator/leader/member instruction docs with distilled lessons before the next batch.

Next-batch selection order:

1. closeout-first for existing `In Review` issues
2. then new actionable work
3. if `Todo/In Progress` empty, choose from `Backlog` with non-overlapping domains

Always announce member mapping explicitly (`memberA=<issue> memberB=<issue>`).

## Observability Fields (must log)

- recipient parse result
- selected pane
- `message_id`, `task_id`, `attempt`
- dedupe hit/miss
- ownership lock action
- retry count/backoff
- workspace path
- current status
- evidence links (PR/CI/Linear comment IDs)
