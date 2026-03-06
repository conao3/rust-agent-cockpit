# Orchestrator Notes (agent-cockpit backend)

This is an internal memo for the orchestrator role (currently manual, later Tauri backend).

## Problem

Leader instructions were routed to both MemberA and MemberB, causing duplicate work.

## Goal

Guarantee one-target delivery for delegated tasks unless the Leader explicitly requests broadcast.

## Symphony-Inspired Execution Principles

Treat each task as an autonomous, isolated run managed by orchestration state instead of ad-hoc chat routing.

- One task = one isolated run context (`task_id`, owner, workspace, branch, run status).
- Orchestrator owns authoritative runtime state for dispatch/retry/reconciliation.
- Policy lives in-repo (this instruction set + issue DoD), not in transient operator memory.
- A run may end in handoff state (`in_review`) before final `done`.
- Every completed run must leave auditable proof (PR, CI, validation, merge metadata).

## Routing Contract

Leader must send one of:

```
@MemberA: <message>
@MemberB: <message>
@AllMembers: <message>   # optional explicit broadcast
```

If recipient is missing or ambiguous, do not route. Return an error to Leader:

```
@Orchestrator: Invalid recipient. Use @MemberA: or @MemberB: (or @AllMembers: explicitly).
```

Completion and merge authority:

- Orchestrator only routes messages and records state.
- Completion judgment belongs to Leader.
- PR review/merge decision belongs to Leader.

## Required Envelope (internal metadata)

Every routed instruction should carry:

- `message_id` (UUID)
- `task_id` (ex: `CON-35`)
- `from` (`Leader`)
- `to` (`MemberA` or `MemberB`)
- `dedupe_key` (`task_id + to + normalized_message_hash`)
- `timestamp`

Recommended additions:

- `attempt` (0 for first run, +1 for each retry)
- `workspace` (resolved path, e.g. `./.wt/con-94-task-registration-ci`)
- `status` (`queued|sent|acknowledged|in_progress|in_review|done|failed`)

## Delivery Rules

1. Parse recipient strictly from prefix.
2. Resolve exactly one target pane unless `@AllMembers:` is used.
3. Send text and submit key separately in tmux:
   - `send-keys "<text>"`
   - `send-keys <submit-key>`
4. Wait for ACK from the target member:
   - `@Leader: ACK <message_id>`
5. If no ACK within timeout, retry only to the same target.
6. Max retry count; then mark failed and notify Leader.

7. Keep bounded concurrency.
   - Do not dispatch more than configured active runs at once.
   - Queue excess tasks and dispatch on slot release.

8. Reconciliation on each poll tick.
   - Re-read tracker state for claimed tasks.
   - If task becomes ineligible (canceled/duplicate/done), stop dispatch/retries and release claim.

9. Completion signal must be explicit.
   - Treat run as `in_review` only when member emits final one-line report (for example `@Leader: <task-id> in_review...`).
   - Do not infer completion from intermediate artifacts only (commit/PR creation/test start).
   - Keep run `in_progress` while terminal stream is active without final report.

## Submit Key Mapping (important)

In Codex TUI panes, submission is triggered by `Ctrl+S` in this environment.

- Use `tmux send-keys ... C-s` to submit.
- `Enter` / `C-m` / `C-j` were observed to insert newline (not submit) in Codex TUI.
- In plain shell panes (`zsh`), `Enter` and `C-m` work as normal newline execution.

## De-duplication Rules

1. Before routing, check `dedupe_key`.
2. If an identical active assignment exists, do not resend.
3. Notify Leader:

```
@Orchestrator: Duplicate assignment suppressed for <task_id> to <member>.
```

4. Keep dedupe records until task is closed or reassigned.

## Task Ownership Lock

Maintain per-task ownership:

- `task_id -> owner_member`

Rules:

1. First successful assignment acquires lock.
2. New assignment of same `task_id` to different member is blocked unless Leader adds override:
   - `@MemberB: [REASSIGN CON-35] ...`
3. On override, release old lock, assign new owner, and notify both members.

## PR Flow Rule (Leader -> MemberA)

For tasks delegated to MemberA:

1. MemberA implements and creates the PR.
2. MemberA reports PR URL to Leader (`@Leader:`).
3. Orchestrator forwards report to Leader without interpreting success/failure.
4. Leader reviews PR.
5. If Leader approves, Leader merges PR.
6. After merge, Leader performs cleanup; Orchestrator only records/monitors.

## Minimal State Machine

Per `(task_id, member)`:

- `queued`
- `sent`
- `acknowledged`
- `in_progress`
- `in_review`
- `done`
- `failed`

Transitions must be monotonic. Ignore stale/out-of-order events.

Retry policy:

- Retry only transient failures.
- Use exponential backoff (attempt-based delay).
- Keep `attempt` in state so resumed runs are deterministic.

## Observability

Log each routing decision:

- parsed recipient
- selected pane
- message_id/task_id
- dedupe hit/miss
- retry count
- final status
- attempt number
- workspace path
- evidence links (PR/CI/Linear comment IDs when available)

Use logs to audit accidental fan-out quickly.

For Codex execution visibility, prefer non-interactive CLI with JSON event logs:

```bash
./scripts/codex_exec_visible.sh <task-id> "<prompt>"
```

This prints events to stdout and also saves them under:

```text
logs/codex/<task-id>/<timestamp>.jsonl
```

Use this path for user-facing traceability instead of tmux keystroke-only operation.

Completion detection heuristic (required):

- Positive signal: final `@Leader:` handoff line appears in run log.
- Negative signal: process ended without final handoff line.
- On negative signal, mark `failed_needs_resume` and re-dispatch resume prompt with same worktree/branch.

Note:

- Member worktrees store logs in each worktree path (for example `./.wt/con-21/logs/...`).
- Do not assume logs are only under the repository root.

## Safe Defaults

- No implicit broadcast.
- No recipient inference.
- No auto-forward on partial parse.
- Fail closed when uncertain.
- No cross-task state mutation outside orchestrator-owned state machine.

## Visibility Rule (tmux team)

- For operator-facing runs, execute Leader/Member jobs inside `agent-cockpit-team` panes so progress is visible in real time.
- Do not rely on background-only execution when user expects live visibility.
- Before starting a new run for the same `task_id`, terminate stale duplicate processes and keep exactly one active run.

These defaults prevent duplicate execution better than permissive routing.

## Post-Merge Worktree Cleanup

After PR is merged, ensure the related worktree is removed by Leader.

Required flow:

1. Detect merge completion (`gh pr view <num> --json mergedAt` or equivalent API).
2. Resolve the task worktree path (for example `./.wt/con-35`).
3. Ensure no active process is using that path.
4. Confirm Leader removed worktree first:
   - `git worktree remove ./.wt/<feature-name>`
5. Confirm Leader deleted local feature branch if no longer needed:
   - `git branch -d <feature-name>`
6. Log cleanup result and notify Leader:

```
@Orchestrator: Worktree cleaned for <task_id> at ./.wt/<feature-name>.
```

Safety:

- Do not remove on unmerged/closed PR.
- Do not force-remove by default.
- If removal fails, report with reason and keep task state as `done_cleanup_pending`.
- Do not try deleting local branch before worktree removal (branch may be locked by worktree).

Main-branch sync safety:

- If `master`/`main` fast-forward pull fails due to divergence, do not force reset.
- Preserve local user changes; prefer rebase flow with conflict reporting.
- If autostash creates conflicts, keep stash entry and report explicit recovery instruction to Leader.

## Batch Retrospective Update (mandatory)

At the end of every batch:

1. Record what failed or caused rework (for example wrong submit key, mixed commits in PR, dependency mismatch).
2. Update `AGENTS.orchestrator.md`, `AGENTS.leader.md`, and `AGENTS.member.md` with concrete rule changes.
3. Apply updates before starting the next batch.
