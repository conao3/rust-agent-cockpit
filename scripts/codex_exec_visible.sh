#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <task-id> <prompt...>" >&2
  echo "Example: $0 CON-85 'Fix compile error in src-tauri/src/main.rs'" >&2
  exit 1
fi

task_id="$1"
shift
prompt="$*"

ts="$(date +%Y%m%d-%H%M%S)"
log_dir="logs/codex/${task_id}"
mkdir -p "$log_dir"
log_file="${log_dir}/${ts}.jsonl"

echo "task_id: ${task_id}"
echo "log: ${log_file}"
echo "prompt: ${prompt}"

codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  --json \
  "$prompt" | tee "$log_file"
