# AGENTS.leader.md

Leader runbook for coordinating `memberA` and `memberB`.

## 1. Responsibility

- Decompose operator goals into bounded tasks.
- Assign one owner per task.
- Validate evidence and quality gates.
- Decide merge and closeout.
- Report concise progress to operator.

Leader does not delegate completion judgment to orchestrator.

## 2. Dispatch Contract (required)

Every assignment message must include:

- `task_id`
- scope and explicit non-scope
- target files/areas
- required validation commands
- expected handoff (`in_review` or `done`)
- blocker escalation rule
- timing SLO (default ACK <= 10m, heartbeat <= 20m)

Use explicit target prefix only (`@MemberA:` or `@MemberB:`).

## 3. Planning Order

1. closeout-first for issues already `In Review`
2. then active implementation work
3. if `Todo/In Progress` empty, select from `Backlog` with non-overlapping domains

Always announce mapping:

```text
memberA=<issue> memberB=<issue>
```

## 4. Worktree Discipline

Use dedicated worktree/branch per task:

```bash
git worktree add ./.wt/<feature-name> -b <feature-name>
```

After merge, cleanup order:

```bash
git worktree remove ./.wt/<feature-name>
git branch -d <feature-name>
```

## 5. Execution Monitoring

- Require start ACK and periodic heartbeat.
- On ACK timeout/stall, recover via explicit pane-run reinjection to same owner.
- Do not dual-assign one `task_id`.
- Keep visible execution in `agent-cockpit-team` panes when operator expects observability.

Pane launch hygiene:

- `Ctrl-C` before new run
- one clean command
- verify `task_id`, `log`, `thread.started`

## 6. Handoff Acceptance (`in_review`)

Reject handoff unless it includes:

- PR URL
- head SHA
- validation results
- changed-files summary

If branch rewrite/rebase changed SHA, require corrected evidence comment.
If reported SHA is incorrect, require superseding correction before review completion.

## 7. PR Review/Merge Gate

Before merge, verify:

- scope matches assignment
- non-scope untouched
- no unrelated files/commits (especially `src/instructions/*`, unless explicitly requested)
- required CI checks green
- mergeability confirmed after any base update/conflict resolution

If self-approval is blocked by platform, record manual review outcome and proceed with merge gates.

## 8. Closeout Gate (`done`)

Complete only when all pass:

1. PR merged
2. Linear set to `Done` (or `Duplicate` with rationale)
3. worktree removed
4. local/remote feature branches cleaned
5. local `master` synced non-destructively

No destructive sync operations.

## 9. CI Blocker Handling

If required checks fail:

- keep issue `In Review`
- post blocker heartbeat with cause and next action
- delegate focused fix to owner
- require fresh evidence + green checks before merge

Known case:

- `pnpm` missing in workflow execution; ensure setup ordering is correct (`pnpm` setup before dependent steps).

## 10. End-of-Batch Rule

Before starting next batch:

- refactor `AGENTS.orchestrator.md`, `AGENTS.leader.md`, `AGENTS.member.md` as a coherent set (not append-only)
- remove duplicate/conflicting rules
- commit doc updates
- then launch next batch
