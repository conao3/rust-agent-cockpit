# AGENTS.orchestrator.md

Canonical backend playbook for agent-cockpit orchestration.
This document is written so any operator can reproduce orchestrator duties end-to-end.

## 1. Mission and Boundary

Orchestrator mission:
- keep the delivery loop moving continuously
- route work unambiguously
- enforce lifecycle/SLO/evidence contracts
- ensure closeout quality and cleanup

Orchestrator must do:
- dispatch, monitoring, recovery, and audit logging
- task lifecycle management across Linear and tmux execution
- Leader supervision handoff and batch progression control

Orchestrator must not do:
- direct feature implementation
- direct PR merge judgment (Leader responsibility)

## 2. System Topology

Execution topology:
- `You -> agent-cockpit backend (orchestrator) -> Leader -> MemberA, MemberB`

tmux session topology (team):
- session: `agent-cockpit-team`
- panes:
  - `0`: Leader
  - `1`: MemberA
  - `2`: MemberB

Server/dev runtime:
- session: `agent-cockpit-server`
- `make dev` should stay running there

## 3. Run State Contract

A run is keyed by `task_id` (typically Linear issue key like `CON-85`).

Required fields:
- owner: `MemberA` or `MemberB`
- workspace: `./.wt/<feature-name>`
- status: `queued|sent|acknowledged|in_progress|in_review|done|failed`
- evidence: PR URL, head SHA, validations, changed-files summary
- timing: ACK timestamp, heartbeat timestamp

State transitions are monotonic.
Ignore stale or out-of-order events.

## 4. Dispatch Protocol

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

Dispatch rules:
- one owner per `task_id` unless explicit broadcast
- no ambiguous target
- no dual assignment of same task

## 5. tmux Operation Rules

Visible-run launch hygiene:
1. sanitize pane (`Ctrl-C`)
2. send command text
3. send `Enter` as a separate action

Important input note:
- command text and submit must be separate operations
- for this environment, treat `Enter` as an explicit dedicated send step

Preferred visible runner:
```bash
./scripts/codex_exec_visible.sh <task-id> "<prompt>"
```

Launch is valid only after confirmation includes:
- `task_id`
- `log`
- `thread.started`

## 6. SLO and Recovery

Default SLO:
- ACK <= 10m
- heartbeat <= 20m

Recovery sequence for stalled run:
1. verify pane/process liveness
2. stop stalled Leader/member run
3. reinject same `task_id` to same owner first
4. reassignment only with explicit Leader override
5. continue supervision after ACK/heartbeat recovery

Do not use self-log tailing alone as recovery strategy.
Recover from member panes directly.

## 7. Acceptance and Closeout Gates

`in_review` is accepted only with complete evidence:
- PR URL
- head SHA
- validations and results
- changed-files summary

If SHA changes due rebase/rewrite:
- require superseding evidence
- require explicit correction when prior SHA was wrong

`done` gate requires all:
1. PR merged
2. Linear moved to `Done` or `Duplicate` with link
3. worktree removed
4. feature branch cleaned up
5. local `master` synced non-destructively

Safety rules:
- no destructive git reset
- no worktree removal before merge
- no branch delete before worktree detach
- if already cleaned, record as already-clean and continue

## 8. Batch Loop (What Orchestrator Does Repeatedly)

For every batch:
1. closeout-first sweep for all `In Review`
2. if no in-review work, select exactly two non-overlapping actionable issues
3. publish explicit mapping (`memberA=<issue>`, `memberB=<issue>`)
4. dispatch with full scope/non-scope/validation/evidence contract
5. supervise ACK/heartbeat and recover if needed
6. close out completed issue immediately even if sibling still running
7. after closeout, dispatch next pair without waiting for new batch boundary when safe
8. before next batch kickoff, recompose AGENTS docs coherently and commit/push

Preflight before dispatch:
- run `git status --short`
- classify dirty entries as:
  - known non-blocking runtime/operator (e.g. `src-tauri/logs/`, `docs/design-pencil.pen`)
  - task-owned
  - unknown/conflicting
- block and escalate only unknown/conflicting entries

## 9. Linear Task Management (Required)

All orchestrated work must be tracked in Linear.

### 9.1 Task Registration Policy

When new work appears (error report, feature request, regression):
1. create a Linear issue first
2. include reproducible context and acceptance criteria
3. define required validations
4. mark scope/non-scope
5. then dispatch to Leader

No untracked task should be dispatched.

### 9.2 Minimum Issue Template

Use this minimum structure when creating a new issue:
- Title: concise action statement
- Description:
  - Background
  - Problem statement
  - Reproduction steps
  - Expected behavior
  - Proposed scope
  - Non-scope
  - Required validation commands
  - Definition of Done
- Labels: component + type (`bug`, `infra`, `frontend`, etc.)
- Assignee: Leader (or left unassigned until planning)
- State: `Todo`/`Backlog` initially

### 9.3 Orchestrator Workflow with Linear

Lifecycle mapping:
- `Todo/In Progress`: ready for assignment or actively implemented
- `In Review`: PR exists, waiting review/merge gate
- `Done`: merged and closeout complete
- `Duplicate`: duplicate confirmed with link to canonical issue

Orchestrator duties in Linear:
- add evidence comment at key transitions (PR, SHA, validation summary)
- keep state synchronized with actual code status
- ensure final state change to `Done` is performed after closeout gate passes

## 10. Branch Contamination Protocol

If two tasks are mixed in one branch/PR:
1. create dedicated branch from `origin/master` for misplaced task
2. cherry-pick misplaced commit to dedicated branch
3. reset original branch to task-pure commit
4. revalidate both tasks and refresh evidence in Linear

## 11. Audit Log Requirements

Record at minimum:
- parse result
- pane target
- `task_id`, `message_id`, `attempt`
- dedupe/lock operations
- retry/timer events
- state transitions
- evidence links (PR/CI/Linear IDs)
- visible run session IDs
- ACK timestamps

## 12. UI Design Verification (Pencil MCP)

For UI-related tasks:
- design can be inspected via Pencil MCP
- primary design file: `/home/conao/ghq/github.com/conao3/rust-agent-cockpit/docs/design-pencil.pen`
- include this path in dispatch and review checklist
