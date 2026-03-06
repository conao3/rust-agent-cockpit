# Orchestrator Notes (agent-cockpit backend)

This is an internal memo for the orchestrator role (currently manual, later Tauri backend).

## Problem

Leader instructions were routed to both MemberA and MemberB, causing duplicate work.

## Goal

Guarantee one-target delivery for delegated tasks unless the Leader explicitly requests broadcast.

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

## Required Envelope (internal metadata)

Every routed instruction should carry:

- `message_id` (UUID)
- `task_id` (ex: `CON-35`)
- `from` (`Leader`)
- `to` (`MemberA` or `MemberB`)
- `dedupe_key` (`task_id + to + normalized_message_hash`)
- `timestamp`

## Delivery Rules

1. Parse recipient strictly from prefix.
2. Resolve exactly one target pane unless `@AllMembers:` is used.
3. Send text and Enter separately in tmux:
   - `send-keys "<text>"`
   - `send-keys C-m`
4. Wait for ACK from the target member:
   - `@Leader: ACK <message_id>`
5. If no ACK within timeout, retry only to the same target.
6. Max retry count; then mark failed and notify Leader.

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

## Minimal State Machine

Per `(task_id, member)`:

- `queued`
- `sent`
- `acknowledged`
- `in_progress`
- `done`
- `failed`

Transitions must be monotonic. Ignore stale/out-of-order events.

## Observability

Log each routing decision:

- parsed recipient
- selected pane
- message_id/task_id
- dedupe hit/miss
- retry count
- final status

Use logs to audit accidental fan-out quickly.

## Safe Defaults

- No implicit broadcast.
- No recipient inference.
- No auto-forward on partial parse.
- Fail closed when uncertain.

These defaults prevent duplicate execution better than permissive routing.

## Post-Merge Worktree Cleanup

After PR is merged, remove the related worktree.

Required flow:

1. Detect merge completion (`gh pr view <num> --json mergedAt` or equivalent API).
2. Resolve the task worktree path (for example `./.wt/con-35`).
3. Ensure no active process is using that path.
4. Remove worktree:
   - `git worktree remove ./.wt/<feature-name>`
5. Delete local feature branch if no longer needed:
   - `git branch -d <feature-name>`
6. Log cleanup result and notify Leader:

```
@Orchestrator: Worktree cleaned for <task_id> at ./.wt/<feature-name>.
```

Safety:

- Do not remove on unmerged/closed PR.
- Do not force-remove by default.
- If removal fails, report with reason and keep task state as `done_cleanup_pending`.
