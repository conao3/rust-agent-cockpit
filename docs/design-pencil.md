# design-pencil.md

Top priority: use `react-aria-components` and `tailwindcss` for UI implementation, and adopt Adobe Spectrum as the visual design system.

References:

- React Aria Components: https://react-aria.adobe.com/getting-started
- Adobe Spectrum: https://spectrum.adobe.com/
- Tailwind CSS (Vite): https://tailwindcss.com/docs/installation/using-vite
- Spectrum Icons (Workflow): `@spectrum-icons/workflow`
- Spectrum Icons (UI): `@spectrum-icons/ui`

## Icon Usage Guide

Use `@spectrum-icons/workflow` for primary actions and navigation, `@spectrum-icons/ui` for compact UI controls.

| Location | Icon | Package | Notes |
|---|---|---|---|
| Header — settings button | `Settings` | workflow | right side of all screen headers |
| Window title bar — close | `CrossSmall` | ui | replaces colored dot close button |
| Agent node — connect handle | `ArrowRight` | workflow | drag handle to create connections |
| Add connection / add agent | `Add` | workflow | "+" action buttons |
| Edit connection/item | `Edit` | workflow | inline edit in lists/tables |
| Delete connection/item | `Delete` | workflow | inline delete in lists/tables |
| Search field | `Magnify` | workflow | search inputs |
| Filter control | `Filter` | workflow | filter toolbar buttons |
| Dropdown indicator | `ChevronDown` | ui | select/dropdown fields |
| Task status — done | `Checkmark` | ui | done state indicator |
| Task status — failed | `AlertCircle` | workflow | failed/error state |
| Task status — in_progress | `Refresh` | workflow | spinning when active |
| Worktree — open | `OpenIn` | workflow | open worktree action |
| Worktree — delete | `Delete` | workflow | delete worktree action |
| Linear inbox — delivered | `CheckmarkCircle` | workflow | delivered status |
| Linear inbox — unroutable | `AlertCircle` | workflow | unroutable status |

## 1. Product Intent

`agent-cockpit` is a Tauri desktop app for operating multiple AI agents as a visible team (Leader + Members) on a single cockpit UI.

Core goals:

- Visualize live agent execution (PTY terminals)
- Visualize communication topology (who can talk to whom)
- Track task lifecycle (`sent/ack/in_progress/in_review/done`)
- Route inter-agent messages via Linear comments
- Run safe parallel work with git worktrees

## 2. Design Assumptions for Pencil

- Current implementation is a **single route page** (no React Router flow yet)
- Navigation is mostly **in-canvas window/panel interaction**, not full page transitions
- All cockpit-specific screens are nested under `/agent-cockpit/:cockpit_id`
- Separate the design file into:
1. Implemented screens (current reality)
2. Planned screens (next-phase UI)

## Route Map

| Route | Screen | Notes |
|---|---|---|
| `/` | SCR-050 Cockpit List | list/create cockpit instances |
| `/agent-cockpit/:cockpit_id` | SCR-100 Cockpit Desktop | main canvas |
| `/agent-cockpit/:cockpit_id?pty=:task_id&agent=:agent_id&cwd=:cwd` | SCR-120 PTY Terminal | query-driven PTY window |
| `/agent-cockpit/:cockpit_id/tasks` | SCR-130 Task Lifecycle Monitor | |
| `/agent-cockpit/:cockpit_id/inbox` | SCR-140 Linear Inbox | |
| `/agent-cockpit/:cockpit_id/settings` | SCR-150 Agent Settings | |
| `/agent-cockpit/:cockpit_id/worktrees` | SCR-160 Worktree Manager | |

## 3. Primary Users

- Human orchestrator/operator
- Leader agent
- Member agents

## 4. Information Architecture

1. Cockpit Desktop (home)
2. Connection Manager
3. PTY Terminal
4. Task & Lifecycle Monitor (planned)
5. Agent Settings (planned)
6. Worktree Manager (planned)
7. Message Routing / Linear Inbox (planned)

## 5. Screen Metadata

### SCR-050: Cockpit List

- Status: Planned
- Route: `/`
- Purpose: manage and select agent cockpit instances
- Main content:
1. list of saved cockpits (name, id, agent count, status, last_used)
2. create new cockpit action
3. open / duplicate / delete per-cockpit actions
- Expected commands:
1. `cockpit_list`
2. `cockpit_create`
3. `cockpit_delete`

### SCR-000: Boot / App Start

- Status: Implemented
- Purpose: initialize backend and app runtime state
- Main behavior:
1. backend monitoring runner starts automatically
2. initial windows are created (Connections, PTY Terminal)
3. PTY context is parsed from query (`task_id/taskId`, `member/agent`, `cwd`)
- Next: `SCR-100`

### SCR-100: Cockpit Desktop

- Status: Implemented
- Purpose: central operation canvas
- Main UI:
1. desktop canvas
2. movable/resizable windows
3. z-order focus management
- State:
1. terminal status `connecting|connected|error`
2. per-window position and size
- User actions:
1. activate window
2. move window
3. resize window
- Internal transitions:
1. to `SCR-110` (Connections interactions)
2. to `SCR-120` (Terminal interactions)

### SCR-110: Connections Window

- Status: Implemented
- Purpose: model/edit directed agent communication edges
- Main UI:
1. graph view (React Flow)
2. connection form (`source`, `target`, `description`)
3. connection list with `edit/remove`
- Main actions:
1. add connection
2. edit connection
3. remove connection
- Validation:
1. source and target are required
2. source and target must differ
3. duplicate edge is not allowed
- Note: currently local UI state only; persistence/runtime routing sync is future scope

### SCR-120: PTY Terminal Window

- Status: Implemented
- Purpose: display and interact with agent process I/O
- Main UI:
1. xterm.js terminal
2. connection status badge
- Backend commands:
1. `pty_create`
2. `pty_write`
3. `pty_resize`
4. `pty_close`
- Event stream:
1. listens to `pty-output`
- Error presentation:
1. `[pty_create/listen error] ...`
2. `[pty_write error] ...`
3. `[pty_resize error] ...`

### SCR-130: Task & Lifecycle Monitor

- Status: Planned
- Purpose: operational visibility of orchestration lifecycle
- Main content:
1. lifecycle states (`queued/sent/acknowledged/in_progress/in_review/done/failed`)
2. current state by `task_id x member`
3. ACK/heartbeat SLA breach alerts
- Expected commands:
1. `task_register_definition`
2. `task_transition_lifecycle`
3. `task_get_lifecycle`
4. `monitoring_get_lifecycle_state`
- Main actions:
1. inspect progress
2. detect stalled runs
3. trigger recovery/re-dispatch

### SCR-140: Message Routing / Linear Inbox

- Status: Planned
- Purpose: observe and debug Linear-based message delivery
- Main content:
1. incoming comment history
2. resolved target member
3. decision status (`delivered/unroutable/duplicate`)
- Expected commands:
1. `linear_ingest_webhook_comment`
2. `linear_ingest_poll_comments`
- Main actions:
1. verify routing success
2. investigate unroutable/duplicate cases

### SCR-150: Agent Settings

- Status: Planned
- Purpose: manage agent runtime profiles
- Expected fields:
1. agent id/name/command
2. restrictions
3. defaults
- Expected commands:
1. `agent_settings_get`
2. `agent_settings_save`

### SCR-160: Worktree Manager

- Status: Planned
- Purpose: manage task-isolated worktree lifecycle
- Main actions:
1. create/open/close/delete worktree
2. view title/metadata
3. prepare hooks
- Expected commands:
1. `worktree_create`
2. `worktree_open`
3. `worktree_close`
4. `worktree_delete`
5. `worktree_title_info`
6. `claude_prepare_worktree_hooks`

## 6. Transition Model

### 6.1 Current Implemented Flow

1. `SCR-000` -> `SCR-100`
2. inside `SCR-100`, users operate `SCR-110` and `SCR-120` in parallel windows
3. no full page transitions yet

### 6.2 Planned Flow Expansion

1. `SCR-100` -> `SCR-130` (lifecycle operations)
2. `SCR-130` -> `SCR-140` (delivery issue drill-down)
3. `SCR-130` -> `SCR-160` (worktree recovery path)
4. `SCR-100` -> `SCR-150` (settings)
5. `SCR-130` -> `SCR-100` (return to live operations)

## 7. What Users Do on Each Screen

1. Cockpit Desktop: monitor global state and control windows
2. Connections: define and maintain communication routes
3. PTY Terminal: run agents, inspect output, detect runtime errors
4. Lifecycle Monitor: track execution state and SLA breaches
5. Linear Inbox: validate/diagnose message routing outcomes
6. Agent Settings: configure runtime behavior and constraints
7. Worktree Manager: manage isolated branches/workspaces safely

## 8. Recommended Pencil Artboards

1. Desktop: 1440x900 (primary)
2. Tablet: 1024x768 (compact operations)
3. Mobile reference: 390x844 (monitoring-only concept)

## 9. Scope Alignment Notes

- Confirmed implemented screens today: `SCR-100`, `SCR-110`, `SCR-120`
- Planned screens (`SCR-130/140/150/160`) are defined from backend command surface and roadmap intent
- In Pencil, keep implemented vs planned on separate pages for review clarity
