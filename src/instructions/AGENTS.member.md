# AGENTS.member.md

Member runbook for implementation tasks under Leader control.

## 1. Responsibility

- Execute only delegated scope.
- Work only in assigned worktree/branch.
- Provide timely status/evidence to Leader.
- Do not merge PRs yourself.

## 2. Messaging Protocol

Use Leader-directed lines only:

```text
@Leader: <message>
```

Required lifecycle messages:

- start ACK: `@Leader: ACK <task-id> start`
- periodic heartbeat within contract window
- blocker report with reason and last completed step
- final handoff (`in_review` or `done`) with evidence

If task is re-injected/restarted, ACK again with same `task_id`.

## 3. Scope and Hygiene

- Stay inside assigned files/areas.
- Avoid broad repo scans when path-scoped search is enough.
- Never include `src/instructions/*` in implementation PR unless explicitly requested.
- Never commit runtime artifact dirs (e.g. `src-tauri/logs/`) unless requested.

## 4. Branch and PR Hygiene

Before final handoff:

- ensure branch contains only task-relevant changes
- rebase/update per Leader instruction
- if rewrite/rebase changes head SHA, report updated SHA
- if conflicts resolved, include short conflict note

MemberA creates PR when requested and shares URL promptly.

## 5. `in_review` Evidence Contract

Final handoff must include:

- `task_id`
- PR URL
- head SHA
- validations run + result
- changed-files summary
- risks/blockers note (`none` if not applicable)

Recommended:

```text
@Leader: <task-id> in_review. commit=<sha> pr=<url> validation='<cmds: ok>' files='<summary>' risks='<none|...>'
```

If blocked:

```text
@Leader: <task-id> blocked. reason=<short-reason> last_step=<summary>
```

## 6. Timing SLO

Default unless overridden:

- ACK <= 10 minutes
- heartbeat <= 20 minutes

If SLO cannot be met, report immediately.
If process exits unexpectedly, report `failed_needs_resume` with last completed step.

## 7. Validation Discipline

- Run exact validations requested in dispatch contract.
- After base update/rebase/conflict fix, rerun required validations.
- If CI is pending/failing after PR, report status and wait for Leader direction.

## 8. Post-Handoff Behavior

After sending `in_review`, stop new feature changes unless Leader explicitly requests follow-up fixes.
If evidence was incorrect (e.g. wrong SHA), send superseding corrected handoff immediately.

## 9. End-of-Batch Contribution

Provide concise implementation lessons so Leader can update the three AGENTS docs coherently.
