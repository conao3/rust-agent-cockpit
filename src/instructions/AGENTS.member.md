# AGENTS.member.md

Member runbook for delegated execution.

## 1. Responsibility

Member must:
- implement only delegated scope
- work only in assigned worktree/branch
- send structured lifecycle messages to Leader
- never merge PRs
- assume implementation ownership once assigned; Leader should remain review/closeout unless operator says otherwise

Delegation integrity note:
- if leader proposes to complete your assigned implementation directly without explicit operator authorization, raise a blocker line immediately

## 2. Message Contract

All messages to Leader must use:
```text
@Leader: <message>
```

Required lifecycle messages:
- start ACK: `@Leader: ACK <task-id> start`
- periodic heartbeat within SLO: `@Leader: <task-id> heartbeat progress=<...> next=<...>`
- blocker: include `reason` and `last_step`
- final handoff: explicit `in_review` or `done`

Reinjection/recovery rules:
- if reinjected, ACK again with same `task_id`
- if leader run was stalled, ACK then send current step immediately
- send ACK before long-running command
- emit final `@Leader ... in_review|done` line before exit
- when continuing from prior batch carry-over, first heartbeat must include the previous step checkpoint and immediate next step
- include the concrete `task_id` token in every heartbeat line so log-based recovery can match runs reliably
- if Leader announces batch-id rollover, continue under the same `task_id` and re-emit ACK once at restart boundary

## 3. Scope and Repo Hygiene

- edit only assigned files/areas
- treat all unassigned work as non-scope and leave it untouched
- avoid broad repo scans unrelated to task
- do not modify `src/instructions/*` unless explicitly assigned
- do not commit runtime artifacts (e.g. `src-tauri/logs/`) unless assigned
- avoid touching known operator-owned dirty files unless assigned
- ignore `docs/design-pencil.pen` unless assigned
- do not escalate/stop only because `src-tauri/logs/` exists as untracked; treat it as known runtime artifact

## 4. Branch Hygiene

Before handoff:
- keep commits task-pure
- apply requested rebase/update
- report updated SHA after rewrite/rebase
- include conflict resolution note when relevant
- if contamination is found, assist split/rebase and resend clean evidence
- when Leader requests carry-over branch rebuild, rebase/cherry-pick onto `origin/master` baseline and resend superseding SHA evidence
- for recovered branches, run `./scripts/guard_recovered_merge_base.sh <branch-or-head>` before `in_review` handoff and include PASS/FAIL evidence

## 5. Evidence Contract (`in_review`)

Handoff must include:
- `task_id`
- PR URL
- head SHA
- validations and results
- changed-files summary
- risk note (`none` if none)
- recovered-branch guard result when applicable

Template:
```text
@Leader: <task-id> in_review. commit=<sha> pr=<url> validation='<cmds: ok>' files='<summary>' risks='<none|...>'
```

Blocked template:
```text
@Leader: <task-id> blocked. reason=<short-reason> last_step=<summary>
```

## 6. Timing SLO

Default SLO unless overridden:
- ACK <= 10m
- heartbeat <= 20m

If SLO risk appears, report immediately.
If process exits unexpectedly, report `failed_needs_resume` with last completed step.
On recovery reinjection, repeat ACK as the very first line before any extra context.

## 7. Validation Rules

- run exact validations from dispatch contract
- rerun required validations after rebase/base update/conflict fix
- if CI is pending/failing, report status and wait for Leader instruction

## 8. Behavior After `in_review`

- stop feature edits unless Leader requests follow-up
- if evidence is wrong (e.g. SHA typo), send corrected superseding message immediately
- if the branch is merge-ready at `in_review`, prioritize immediate closeout support in the same supervision cycle (no deferred follow-up)
- if sibling issue is still active, do not start unrelated edits
- treat next assignment as new run only after explicit new `task_id`
- report current branch/worktree state; Leader handles closeout

## 9. End-of-Batch Input

Send concise lessons learned so Leader can recompose AGENTS docs next batch.

## 10. Linear and Design Notes

Linear:
- include task id/state context in updates so Leader can sync Linear correctly
- when handoff state changes (`in_review`/`done`), send update details immediately so Linear state stays synchronized

UI design verification:
- verify UI tasks against Pencil MCP design source
- `/home/conao/ghq/github.com/conao3/rust-agent-cockpit/docs/design-pencil.pen`
- mention intentional deviations in final handoff
