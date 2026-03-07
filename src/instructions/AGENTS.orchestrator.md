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
- do not use self-referential leader-log tailing as the primary control loop for recovery decisions

Preferred runner:

```bash
./scripts/codex_exec_visible.sh <task-id> "<prompt>"
```

Recovery priority when a leader run stalls:

1. verify pane/process liveness
2. stop the stalled leader run
3. reinject explicit recovery tasks to target member panes with same `task_id`
4. resume leader supervision after member ACK/heartbeat is re-established

## G. Acceptance Rules

Accept `in_review` only with complete evidence bundle.

If branch rewrite/rebase changes SHA:

- require refreshed evidence comment with new SHA
- if prior SHA was wrong, require explicit superseding correction

If a recovery run completes implementation but misses the final `@Leader ... in_review` line:

- do not treat terminal completion alone as accepted handoff
- require Leader to record an evidence checkpoint (PR URL, SHA, validations, changed files) in Linear before any closeout action

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
6. run preflight repo check (`git status --short`) and classify dirty entries before dispatch (task-owned / operator-owned / unknown)

Preflight handling rule:

- known operator/runtime untracked entries (for example `docs/design-pencil.pen`, `src-tauri/logs/`) are classified as non-blocking and must not stop the batch
- stop and escalate only for unknown or task-conflicting dirty entries

In mixed-progress batches:

- if one issue reaches `in_review` earlier, switch that issue to immediate closeout flow without blocking the sibling issue run
- continue monitoring the remaining sibling run against the same ACK/heartbeat SLO and evidence rules

After closeout completion inside a batch:

- it is valid to dispatch the next two non-overlapping issues in the same batch
- when those runs are already spawned, the next batch must monitor/recover those active runs first (no duplicate re-dispatch)

Branch contamination recovery rule:

- if two task commits are mixed into one branch/PR, split immediately:
  1) create dedicated branch from `origin/master` for the misplaced task
  2) cherry-pick misplaced commit to dedicated branch
  3) reset original branch to task-pure commit
  4) verify each PR changed-files scope before setting `in_review`

## K. Audit Fields

Log minimum fields:

- parse result
- pane target
- `task_id`, `message_id`, `attempt`
- dedupe/lock actions
- retries and timers
- state transitions
- evidence links (PR/CI/Linear comment IDs)
- member run session identifiers (when visible dispatch starts)
- ACK receipt timestamps per `task_id`

## L. Design Verification (Pencil MCP)

- Design can be inspected via Pencil MCP during implementation/review.
- Primary design file: `/home/conao/ghq/github.com/conao3/rust-agent-cockpit/docs/design-pencil.pen`
- When UI tasks are dispatched, include this reference in the task contract.
