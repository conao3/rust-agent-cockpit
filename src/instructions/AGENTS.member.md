# AGENTS.member.md

Member execution runbook for delegated tasks.

## A. Core Responsibility

- implement only delegated scope
- work only in assigned worktree/branch
- send timely, structured updates to Leader
- do not merge PRs

## B. Message Format

All outbound messages use:

```text
@Leader: <message>
```

Required lifecycle messages:

- start ACK: `@Leader: ACK <task-id> start`
- periodic heartbeat within SLO
- blocker report (`reason`, `last_step`)
- final handoff with evidence

If run is reinjected/restarted, ACK again with same `task_id`.
If recovery is reinjected from a stalled leader run, send ACK first, then immediately include current step so leader can rebuild supervision state.
Before exit, always emit the final `@Leader ... in_review|done` line explicitly, even if PR creation/validation already succeeded.
Send ACK before any long-running command so leader can timestamp SLA compliance reliably.

## C. Scope and Repo Hygiene

- keep edits within assigned files/areas
- avoid unnecessary wide scans
- do not include `src/instructions/*` in implementation PR unless explicitly requested
- do not commit runtime artifacts (e.g. `src-tauri/logs/`) unless requested
- if leader reports known main-tree dirty files, avoid touching them unless explicitly assigned
- ignore known operator/design artifacts (e.g. `docs/design-pencil.pen`) unless explicitly assigned

## D. Branch Hygiene

Before handoff:

- ensure task-pure commits
- apply Leader-requested rebase/update
- report updated SHA after rewrite/rebase
- include short conflict note if conflict resolved

## E. Evidence Contract (`in_review`)

Handoff must include:

- `task_id`
- PR URL
- head SHA
- validation commands and results
- changed-files summary
- risks note (`none` if not applicable)

Template:

```text
@Leader: <task-id> in_review. commit=<sha> pr=<url> validation='<cmds: ok>' files='<summary>' risks='<none|...>'
```

Blocked template:

```text
@Leader: <task-id> blocked. reason=<short-reason> last_step=<summary>
```

## F. Timing SLO

Default SLO unless overridden:

- ACK <= 10m
- heartbeat <= 20m

If SLO breach risk appears, report immediately.
If process exits unexpectedly, report `failed_needs_resume` with last completed step.

## G. Validation Rules

- run exact validations from dispatch contract
- rerun required validations after base update/rebase/conflict fix
- if CI pending/failing, report status and wait for Leader instruction

## H. After `in_review`

After `in_review` handoff, stop feature edits unless Leader asks for follow-up.
If any evidence was wrong (e.g. SHA typo), send superseding corrected handoff immediately.
If your sibling issue is still in progress, do not resume unrelated edits after handoff; wait for explicit Leader instruction.
If Leader keeps the same batch open and immediately starts the next assignment set, treat it as a new run only after explicit new `task_id` ACK.

## I. End-of-Batch Input

Include concise lessons learned so Leader can recompose AGENTS docs cleanly each batch.
