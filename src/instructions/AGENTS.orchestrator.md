# AGENTS.orchestrator.md

Canonical backend policy for agent-cockpit orchestration.

## A. Scope of Orchestrator

Orchestrator responsibilities:

- strict routing and dispatch
- run lifecycle state management
- dedupe, ownership lock, retry, reconciliation
- heartbeat/liveness monitoring
- evidence/audit logging

Non-responsibilities:

- no feature implementation
- no PR quality judgment or merge decision (Leader responsibility)

## B. Run Contract

A run is identified by `task_id` and must keep:

- owner: `MemberA` or `MemberB`
- workspace: `./.wt/<feature-name>`
- status: `queued|sent|acknowledged|in_progress|in_review|done|failed`
- evidence bundle: PR URL, head SHA, validations, changed-files summary

Transition is monotonic; ignore stale/out-of-order events.

## C. Routing Grammar

Accepted directives:

- `@MemberA: <message>`
- `@MemberB: <message>`
- `@AllMembers: <message>` (explicit broadcast only)

Ambiguous/missing target must be rejected.

## D. Required Dispatch Metadata

- `message_id` (UUID)
- `task_id`
- `from=Leader`
- `to=MemberA|MemberB`
- `attempt` (0-based)
- `workspace`
- `dedupe_key`
- `timestamp`
- current `status`

## E. Delivery and Ownership Rules

1. one target only unless explicit broadcast
2. text send and submit action are separated
3. ownership lock: one active owner per `task_id`
4. ACK timeout => immediate same-pane reinjection (same owner)
5. bounded retries with backoff
6. reassignment only with explicit Leader override

## F. Visibility Rules (tmux)

For operator-visible runs (`agent-cockpit-team`):

- sanitize pane input (`Ctrl-C`) before dispatch
- launch one clean command
- start confirmation requires `task_id`, `log`, and `thread.started`
- monitor SLO: ACK <= 10m, heartbeat <= 20m (unless overridden)

Preferred runner:

```bash
./scripts/codex_exec_visible.sh <task-id> "<prompt>"
```

## G. Acceptance Rules

Accept `in_review` only with complete evidence bundle.

If branch rewrite/rebase changes SHA:

- require refreshed evidence comment with new SHA
- if prior SHA was wrong, require explicit superseding correction

## H. Closeout Gate

`done` only when all pass:

1. PR merged
2. Linear moved to `Done` or `Duplicate` with link
3. worktree removed
4. feature branch cleanup complete
5. local `master` synced non-destructively

Safety rules:

- no destructive reset
- no worktree removal on unmerged PR
- no branch delete before worktree detach

## I. Blocker Handling

If required checks fail:

- keep issue in `In Review`
- emit blocker heartbeat
- dispatch focused remediation to owner
- require fresh green required checks before merge

Known failure pattern:

- CI error `Unable to locate executable file: pnpm`
- validate setup ordering so `pnpm` is available before dependent steps

## J. Batch Policy

Every batch follows:

1. closeout-first sweep
2. if none in-review, pick exactly two non-overlapping actionable issues
3. publish explicit mapping (`memberA=<issue>`, `memberB=<issue>`)
4. enforce full contract (scope/validation/SLO/evidence)
5. recompose AGENTS docs as one coherent set before next batch

## K. Audit Fields

Log minimum fields:

- parse result
- pane target
- `task_id`, `message_id`, `attempt`
- dedupe/lock actions
- retries and timers
- state transitions
- evidence links (PR/CI/Linear comment IDs)
