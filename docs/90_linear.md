# Linear Usage Guide

This document describes how we use Linear for project management and inter-agent messaging in agent-cockpit.

## Structure

```
Workspace
└── Team (Conao3)
    ├── Project  ← a deliverable with a clear scope (e.g. rust-agent-cockpit)
    │   ├── Milestone  ← a phase or release gate within the project
    │   │   ├── Issue  ← a concrete task
    │   │   │   └── Sub-issue  ← breakdown of the parent task
    │   │   └── Issue
    │   └── Milestone
    └── Project
```

### When to create each

| Concept | When to create |
|---|---|
| **Project** | One per repository or major product area |
| **Milestone** | One per development phase (Phase 0, Phase 1, …) |
| **Issue** | One per meaningful unit of work (can be completed in one session) |
| **Sub-issue** | When an Issue needs to be broken down further |

## Project Setup Checklist

1. Create the project with `state: Planned` and assign it to a team
2. Create milestones in order, each with a `description` that explains the goal and done criteria
3. Create parent Issues per milestone
4. Break each parent Issue into Sub-issues
5. Cancel or archive tutorial/placeholder issues (e.g. Linear's default onboarding issues)

## Milestone Descriptions

Always write a description for every milestone. It should answer:

- What is being built in this phase?
- What is the done condition? ("When this phase is complete, X is possible")
- Any constraints or dependencies on other phases

Example:

> PTY process management and xterm.js terminal display. The Rust backend spawns and manages PTY processes, streams output to the frontend via Tauri IPC. Key input is forwarded to the PTY.

## Issue Hierarchy

```
Phase 1: PTY Foundation           ← Milestone
├── PTY Backend Implementation    ← Parent Issue (CON-21)
│   ├── Integrate portable-pty    ← Sub-issue (CON-36)
│   ├── Process lifecycle mgmt    ← Sub-issue (CON-37)
│   └── IPC stream forwarding     ← Sub-issue (CON-38)
└── PTY Frontend Integration      ← Parent Issue (CON-22)
    ├── Integrate xterm.js        ← Sub-issue (CON-39)
    └── Forward key input to PTY  ← Sub-issue (CON-40)
```

Parent Issues represent a coherent area of work. Sub-issues are the actual implementation tasks assigned to agents.

## Priority Levels

| Priority | Use |
|---|---|
| Urgent | Must be done before anything else (blocks other phases) |
| High | Core feature, current phase |
| Medium | Important but not blocking |
| Low | Nice to have, research, or future work |

Set priority based on the phase: Phase 0–1 tasks are Urgent, Phase 2–4 are High, Phase 5–6 are Medium.

## Agent Messaging via Linear Comments

Linear Issue Comments serve as the message transport for inter-agent communication.

### Convention

Each agent is associated with one Linear Issue (its current task). Other agents send messages by posting comments on that Issue.

```
@agent-b: Please implement the PTY resize handler and reply when done.
```

cockpit monitors for new comments via:
1. **Linear Webhook** (preferred) — push notification when a comment is created
2. **Polling** (fallback) — cockpit polls the Linear API at a configurable interval

When a comment arrives, cockpit checks the edge graph and injects the comment body into the target agent's PTY stdin.

### Message lifecycle

1. Sender agent posts a comment on the target Issue
2. cockpit receives the event (webhook or poll)
3. cockpit resolves the target agent by Issue ID
4. cockpit checks that an edge exists from sender to target
5. cockpit injects the comment into the target's PTY stdin
6. Target agent processes the input and may reply with another comment

### Comment format

Keep comments concise and actionable. Prefix with the sender's agent name for clarity:

```
[leader] Break down CON-21 into the following sub-tasks and implement them in order: ...
```

## Workflow for Agents

When starting work on an Issue:

1. Read the Issue description and all comments
2. Set the Issue status to **In Progress**
3. Create your git worktree from the Issue's `gitBranchName` field
4. Implement the task
5. Post a summary comment describing what was done
6. Set the Issue status to **Done**

When blocked:

- Post a comment on the Issue explaining the blocker
- Tag the relevant agent or human by name in the comment

## Linear API Access

Set the following environment variable before launching cockpit:

```bash
export LINEAR_API_KEY=lin_api_...
```

The API key is used for:
- Fetching Issue and comment data
- Posting comments on behalf of agents (via cockpit)
- Registering and receiving webhooks

## Useful Linear MCP Commands

When working inside Claude Code with the Linear MCP server available:

```
# List issues in the current project
mcp__linear__list_issues project:"rust-agent-cockpit"

# Post a comment on an issue
mcp__linear__save_comment id:"CON-21" body:"..."

# Update issue status
mcp__linear__save_issue id:"CON-21" state:"In Progress"
```
