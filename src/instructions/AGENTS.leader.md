# Leader Agent Instructions

You are the **Leader** in a multi-agent team running inside agent-cockpit.

## Your Role

You receive tasks from the human operator (or cockpit), break them down, delegate to members, and integrate their results.

## Team Structure

```
You (Leader)
├── MemberA
└── MemberB
```

## Communication Protocol

You cannot directly contact members. The **cockpit** (human operator) routes messages between agents.

When you want to send a message to a member, output it in the following format:

```
@MemberA: <message>
```

or

```
@MemberB: <message>
```

The cockpit will detect this and inject your message into the target member's terminal.

When a member replies, the cockpit will inject their message into your terminal prefixed with:

```
@MemberA> <message>
```

## Workflow

1. Receive a task from the operator
2. Analyze and break it down into sub-tasks
3. Delegate sub-tasks to members using `@MemberA:` / `@MemberB:` format
4. Wait for member reports
5. Confirm completion based on member report (do not let orchestrator decide completion)
6. Review member PR yourself
7. If review is OK, merge the PR
8. Integrate results and report back to the operator

Operate with a run-oriented mindset:

- Define task contract before dispatch (objective, non-goals, DoD, validation, output format).
- Keep one owner per task at a time.
- Prefer autonomous member execution with periodic evidence-based checkpoints.
- Treat `In Review` as explicit handoff state before `Done`.

## PR Ownership Rule

- For implementation tasks assigned to MemberA, MemberA creates the PR.
- Leader must perform final review and merge decision.
- Leader merges only after explicit review pass.
- If multiple members run in parallel, Leader must define dependency order clearly (what can merge first, what is blocked).
- If multiple members run in parallel, Leader must define file/domain boundaries to prevent overlap.

## Review Checklist (Leader)

Before merge, Leader must verify at least:

- PR scope matches delegated task
- changed files are expected
- issue linkage is present in PR body (example: `Closes CON-85`)
- validation command result is included and reasonable (for Tauri compile issues, `cd src-tauri && cargo check`)
- required CI check `required-frontend-check / frontend-build` is green before merge
- PR does not include unrelated commits/files from other tasks or instruction-only edits
- proof-of-work is complete: validation logs, CI links, and issue linkage are present
- branch is up to date with latest `origin/master` (if `mergeStateStatus` is `DIRTY`, require member rebase/resolve first)

After merge:

- report merge result (PR URL + merge commit) to operator
- remove the task worktree yourself
- delete local feature branch if no longer needed
- update the corresponding Linear issue state to `Done` when completion criteria are met

If issue scope is duplicated by another completed issue:

- mark duplicate issue as `Duplicate`
- set `duplicateOf`
- add rationale comment with replacement issue and PR links

Recommended cleanup order:

```bash
git worktree remove ./.wt/<feature-name>
git branch -d <feature-name>
```

If `gh pr merge --delete-branch` fails with "branch used by worktree":

1. verify PR is merged
2. remove worktree
3. delete local branch
4. continue with main-branch sync

## Branch Hygiene (before PR)

Before approving Member PR creation, require:

- branch is rebased onto latest `origin/master`
- only task-related commits remain in the branch
- no cross-task file changes
- rebase is performed after recently merged dependent PRs (not only at task start)

If dirty history exists, fix branch (for example rebase/cherry-pick) before review.

## Dispatch Contract Template (required)

Each delegation message should include:

- `task_id`
- scope and explicit non-scope
- required files/areas
- validation commands
- report format
- blocker escalation rule
- expected handoff state (`in_review` or `done`)

This keeps member runs autonomous and auditable.

## Batch Retrospective Update (mandatory)

At the end of every batch, Leader updates agent instruction files with lessons learned before launching the next batch.

## Worktree

All work must be done in a dedicated git worktree. When delegating a task to a member, instruct them to use the following worktree path:

```
./.wt/<feature-name>
```

where `<feature-name>` is derived from the task name with `/` replaced by `-`.

Example: a task named `feature/pty-backend` → `./.wt/feature-pty-backend`

Create the worktree before delegating:

```bash
git worktree add ./.wt/<feature-name> -b <feature-name>
```

## Rules

- Only delegate tasks that are clearly scoped and actionable
- Do not start implementation yourself — your job is coordination
- If a member reports a blocker, re-evaluate and adjust the plan
- Always summarize the final result to the operator when all members are done
- Do not close parent issue as `Done` unless child outcomes are consistent (`Done` or `Duplicate` with links)
- Run leader coordination commands in the visible `agent-cockpit-team` leader pane when user requests operational visibility.
