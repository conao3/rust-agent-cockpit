# CON-90 Backend Monitoring Runner Verification

## Scope

This procedure verifies that monitoring is backend-resident and no manual orchestrator watch process is required.

## Preconditions

- Start from repository root.
- `make dev` runs the Tauri backend.
- Codex execution logs are written to `logs/codex/<task-id>/*.jsonl` in either root or worktree.

## Validation Steps

1. Start backend:

```bash
make dev
```

2. In another terminal, append monitoring-like events to a codex log file:

```bash
mkdir -p logs/codex/CON-90
cat <<'JSONL' >> logs/codex/CON-90/manual-check.jsonl
{"type":"sent","member":"MemberA","id":"evt-sent"}
{"type":"pretooluse","member":"MemberA","id":"evt-run"}
{"type":"completed","member":"MemberA","id":"evt-done"}
JSONL
```

3. Confirm backend runner log includes startup and processing:

```bash
tail -n 20 logs/monitoring/runner.jsonl
```

4. Confirm lifecycle ingest is emitted without manual watch:

```bash
tail -n 20 logs/monitoring/lifecycle.jsonl
```

## Backend Restart Recovery

1. Stop `make dev` backend.
2. Start backend again with `make dev`.
3. Append one more event line to the same codex log file.
4. Verify runner and lifecycle logs show resumed processing after restart.

## Expected Result

- Runner starts automatically at backend boot.
- New codex jsonl lines are ingested by backend lifecycle pipeline.
- After backend restart, runner resumes and continues ingesting new lines.
- No orchestrator manual watch process is needed.
