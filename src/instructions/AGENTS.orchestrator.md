# AGENTS.orchestrator.md

Canonical backend playbook for agent-cockpit orchestration.
This document is written so any operator can reproduce orchestrator duties end-to-end.

## 1. Mission and Boundary

Orchestrator mission:
- keep delivery moving continuously
- route work unambiguously
- enforce lifecycle/SLO/evidence contracts
- ensure closeout quality and cleanup

Orchestrator must do:
- dispatch, monitoring, recovery, and audit logging
- lifecycle management across Linear and tmux execution
- supervision handoff between Operator, Leader, and Members

Orchestrator must not do:
- direct feature implementation
- direct PR quality judgment or merge decision (Leader responsibility)

## 2. System Topology

Execution topology:
- `You -> agent-cockpit backend (orchestrator) -> Leader -> MemberA, MemberB`

Team tmux topology:
- session: `agent-cockpit-team`
- panes: `0=Leader`, `1=MemberA`, `2=MemberB`

Server runtime:
- session: `agent-cockpit-server`
- keep `make dev` running there

## 3. Run State Contract

A run is keyed by `task_id` (normally Linear key such as `CON-85`).

Required fields:
- owner: `MemberA` or `MemberB`
- workspace: `./.wt/<feature-name>`
- status: `queued|sent|acknowledged|in_progress|in_review|done|failed`
- evidence: PR URL, head SHA, validations, changed-files summary
- timing: ACK timestamp, heartbeat timestamp

State transitions are monotonic. Ignore stale/out-of-order events.

## 4. Dispatch Contract

Allowed directives:
- `@MemberA: <message>`
- `@MemberB: <message>`
- `@AllMembers: <message>` only for explicit broadcast

Every dispatch must include:
- `message_id` (UUID)
- `task_id`
- `from=Leader`
- `to=MemberA|MemberB`
- `attempt` (0-based)
- `workspace`
- `dedupe_key`
- `timestamp`
- current `status`

Rules:
- one owner per `task_id` unless explicit broadcast
- reject ambiguous target
- no dual assignment on same `task_id`

## 5. tmux Input and Launch Rules

Visible run launch hygiene:
1. sanitize pane (`Ctrl-C`)
2. send command text
3. send `Enter` in a separate action

Input rule:
- command text and submit are independent operations
- treat submit as explicit `Enter` step

Preferred visible runner:
```bash
./scripts/codex_exec_visible.sh <task-id> "<prompt>"
```

Launch is valid only after output confirms:
- `task_id`
- `log`
- `thread.started`

## 6. SLO and Recovery

Default SLO:
- ACK <= 10m
- heartbeat <= 20m

Stall recovery sequence:
1. verify pane/process liveness
2. stop stalled run
3. reinject same `task_id` to same owner first
4. reassign only with explicit Leader override
5. resume supervision after ACK/heartbeat recovery

Do not rely on self-log tailing alone for recovery. Use direct member-pane reinjection.

## 7. Acceptance and Closeout Gates

`in_review` acceptance requires:
- PR URL
- head SHA
- validations and results
- changed-files summary

If SHA changes after rewrite/rebase:
- require superseding evidence
- require explicit correction if prior SHA was wrong

`done` requires all:
1. PR merged
2. Linear moved to `Done` or `Duplicate` with link
3. worktree removed
4. task branch cleaned up
5. local `master` synced non-destructively

Safety rules:
- no destructive reset
- no worktree removal before merge
- no branch delete before worktree detach
- if already cleaned, record as already-clean and continue

## 8. Batch Loop

For each batch:
1. closeout-first sweep (`In Review`)
2. if none, pick exactly two non-overlapping actionable issues
3. publish explicit mapping (`memberA=<issue>`, `memberB=<issue>`)
4. dispatch with full scope/non-scope/validation/evidence contract
5. supervise ACK/heartbeat and recover on stall
6. close out finished issue immediately even if sibling still running
7. dispatch next pair when safe
8. recompose AGENTS docs and push before next batch kickoff

Preflight before dispatch:
- run `git status --short`
- classify dirty entries: known non-blocking / task-owned / unknown-conflicting
- known non-blocking examples: `src-tauri/logs/`, `docs/design-pencil.pen`
- block and escalate only unknown/conflicting entries

## 9. Linear Task Management (Required)

All orchestrated work must exist as Linear issues.
No untracked task dispatch.

When creating a task:
1. create issue first
2. include reproducible background and problem statement
3. include scope and non-scope
4. include required validation commands
5. define Definition of Done
6. then dispatch to Leader

Minimum issue template:
- title: concise action
- description:
  - background
  - reproduction
  - expected behavior
  - scope
  - non-scope
  - validation
  - DoD
- labels: component + type (`bug`, `infra`, `frontend` ...)
- initial state: `Todo` or `Backlog`

Lifecycle mapping:
- `Todo/In Progress`: queued or active
- `In Review`: PR exists and waiting gate
- `Done`: merged and closeout complete
- `Duplicate`: duplicate with canonical link

Orchestrator Linear duties:
- keep status synchronized with actual code state
- add evidence comments at key transitions (PR/SHA/validation)
- move to `Done` only after closeout gate passes

## 10. Branch Contamination Protocol

If two tasks are mixed into one branch/PR:
1. create dedicated branch from `origin/master` for misplaced task
2. cherry-pick misplaced commit to dedicated branch
3. reset original branch to task-pure commit
4. refresh evidence and validations for both tasks

## 11. Audit Minimum Fields

Log at minimum:
- parse result
- pane target
- `task_id`, `message_id`, `attempt`
- dedupe/lock actions
- retry/timer events
- state transitions
- evidence links (PR/CI/Linear IDs)
- visible run session identifiers
- ACK timestamps

## 12. UI Design Verification (Pencil MCP)

For UI tasks:
- verify implementation via Pencil MCP
- design source: `/home/conao/ghq/github.com/conao3/rust-agent-cockpit/docs/design-pencil.pen`
- include this reference in dispatch and review checklist
