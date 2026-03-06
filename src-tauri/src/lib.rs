use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
#[cfg(not(test))]
use std::fs::{create_dir_all, OpenOptions};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const COCKPIT_HOOK_SCRIPT_RELATIVE_PATH: &str = ".claude/hooks/cockpit-monitor.sh";
const COCKPIT_CLAUDE_SETTINGS_RELATIVE_PATH: &str = ".claude/settings.json";
const COCKPIT_HOOK_SOURCE: &str = "claude_hook";

struct ClaudeHookSpec {
    event_name: &'static str,
    state: &'static str,
}

const CLAUDE_HOOK_SPECS: [ClaudeHookSpec; 5] = [
    ClaudeHookSpec {
        event_name: "Stop",
        state: "human_turn",
    },
    ClaudeHookSpec {
        event_name: "PreToolUse",
        state: "tool_running",
    },
    ClaudeHookSpec {
        event_name: "PostToolUse",
        state: "tool_running",
    },
    ClaudeHookSpec {
        event_name: "TaskCompleted",
        state: "done",
    },
    ClaudeHookSpec {
        event_name: "PostToolUseFailure",
        state: "failed",
    },
];

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Default)]
struct PtyManager {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, PtySession>>,
    routes: Mutex<HashMap<String, String>>,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Option<JoinHandle<()>>,
    task_id: Option<String>,
    member: Option<String>,
}

#[derive(Clone, Default)]
struct WorktreeManager {
    sessions: Arc<Mutex<HashMap<String, WorktreeSession>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeSession {
    key: String,
    branch: String,
    worktree_dir: String,
    title: String,
    deletehook: Option<String>,
}

#[derive(Clone, Default)]
struct MonitoringManager {
    state: Arc<Mutex<MonitoringState>>,
    runner_started: Arc<Mutex<bool>>,
}

#[derive(Default)]
struct MonitoringState {
    task_states: HashMap<String, TaskLifecycleRecord>,
    task_definitions: HashMap<String, TaskDefinitionRecord>,
    seen_event_keys: HashSet<String>,
    seen_linear_event_keys: HashSet<String>,
}

#[derive(Debug, Clone)]
struct TaskLifecycleRecord {
    task_id: String,
    member: String,
    state: TaskLifecycleState,
    last_event_id: Option<String>,
    updated_at_ms: u64,
    history_len: usize,
}

#[derive(Debug, Clone, Default)]
struct TaskDefinitionRecord {
    title: Option<String>,
    dedupe_key: Option<String>,
    auto_registered: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TaskLifecycleState {
    Sent,
    Ack,
    InProgress,
    Done,
    Failed,
}

impl TaskLifecycleState {
    fn rank(self) -> u8 {
        match self {
            Self::Sent => 0,
            Self::Ack => 1,
            Self::InProgress => 2,
            Self::Done | Self::Failed => 3,
        }
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Failed)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LifecycleDecision {
    Applied,
    Duplicate,
    Stale,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleIngestRequest {
    task_id: String,
    member: String,
    state: TaskLifecycleState,
    message_id: Option<String>,
    dedupe_key: Option<String>,
    source: Option<String>,
}

impl LifecycleIngestRequest {
    fn event_key(&self) -> String {
        if let Some(dedupe_key) = self
            .dedupe_key
            .as_deref()
            .map(str::trim)
            .filter(|key| !key.is_empty())
        {
            return dedupe_key.to_string();
        }
        format!(
            "{}:{}:{:?}:{}",
            self.task_id,
            self.member,
            self.state,
            self.message_id.clone().unwrap_or_default()
        )
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleIngestResponse {
    decision: LifecycleDecision,
    task_id: String,
    member: String,
    current_state: TaskLifecycleState,
    event_key: String,
    updated_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleStateQueryRequest {
    task_id: String,
    member: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LifecycleStateResponse {
    task_id: String,
    member: String,
    state: TaskLifecycleState,
    last_event_id: Option<String>,
    updated_at_ms: u64,
    history_len: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskRegistrationRequest {
    task_id: String,
    member: String,
    title: Option<String>,
    dedupe_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskLifecycleTransitionRequest {
    task_id: String,
    member: String,
    state: TaskLifecycleState,
    message_id: Option<String>,
    dedupe_key: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskLifecycleLookupRequest {
    task_id: String,
    member: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TaskLifecycleSnapshot {
    task_id: String,
    member: String,
    title: Option<String>,
    dedupe_key: Option<String>,
    state: Option<TaskLifecycleState>,
    last_event_id: Option<String>,
    updated_at_ms: Option<u64>,
    history_len: usize,
}

#[derive(Default)]
struct MonitoringRunnerCursor {
    offsets: HashMap<String, u64>,
    pending: HashMap<String, Vec<u8>>,
}

#[derive(Debug, Clone)]
struct MonitoringRunnerEvent {
    request: LifecycleIngestRequest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MonitoringRunnerIgnoreReason {
    NonLifecyclePayload,
    MissingTaskId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum MonitoringRunnerParseError {
    InvalidJson(String),
}

impl std::fmt::Display for MonitoringRunnerParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(message) => write!(f, "invalid runner event json: {message}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LinearCommentParseError {
    EmptyIssueId,
    EmptyBody,
    MissingTargetMember,
    EmptyNormalizedBody,
}

impl std::fmt::Display for LinearCommentParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyIssueId => write!(f, "issue_id must not be empty"),
            Self::EmptyBody => write!(f, "body must not be empty"),
            Self::MissingTargetMember => {
                write!(f, "target_member could not be resolved from comment")
            }
            Self::EmptyNormalizedBody => write!(f, "normalized body must not be empty"),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct MonitoringRunnerOffsets {
    files: HashMap<String, u64>,
}

#[derive(Debug, Deserialize)]
struct CodexEventEnvelope {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default)]
    item: Option<CodexEventItem>,
}

#[derive(Debug, Deserialize)]
struct CodexEventItem {
    #[serde(rename = "type")]
    item_type: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyCreateRequest {
    cols: u16,
    rows: u16,
    command: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    task_id: Option<String>,
    member: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyCreateResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeWorktreeHooksRequest {
    worktree_dir: String,
    task_id: String,
    member: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ClaudeWorktreeHooksResponse {
    settings_path: String,
    hook_script_path: String,
    log_file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyWriteRequest {
    id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyResizeRequest {
    id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PtyCloseRequest {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeCreateRequest {
    branch: String,
    basedir: String,
    hook: Option<String>,
    deletehook: Option<String>,
    copyignored: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeOpenRequest {
    branch: String,
    basedir: String,
    hook: Option<String>,
    deletehook: Option<String>,
    copyignored: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeCloseRequest {
    branch: String,
    basedir: String,
    delete_on_close: Option<bool>,
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeDeleteRequest {
    branch: String,
    basedir: String,
    deletehook: Option<String>,
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeTitleInfoRequest {
    branch: String,
    basedir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeLifecycleResponse {
    branch: String,
    worktree_dir: String,
    title: String,
    created: bool,
    exists: bool,
    opened: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeCloseResponse {
    branch: String,
    worktree_dir: String,
    title: String,
    removed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeDeleteResponse {
    branch: String,
    worktree_dir: String,
    title: String,
    removed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutputEvent {
    id: String,
    data: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinearCommentEnvelope {
    issue_id: String,
    comment_id: Option<String>,
    body: String,
    target_member: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinearPollIngestRequest {
    comments: Vec<LinearCommentEnvelope>,
}

#[derive(Debug, Clone)]
struct NormalizedLinearMessage {
    issue_id: String,
    target_member: String,
    body: String,
    source: String,
    event_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LinearMessageDecision {
    Delivered,
    Duplicate,
    Unroutable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinearMessageIngestResponse {
    decision: LinearMessageDecision,
    issue_id: String,
    target_member: String,
    normalized_body: String,
    source: String,
    pty_id: Option<String>,
    event_key: String,
}

fn make_pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string())
}

fn worktree_slug(branch: &str) -> String {
    branch
        .trim()
        .replace('/', "-")
        .replace('\\', "-")
        .replace(' ', "-")
}

fn validate_worktree_branch(branch: &str) -> Result<String, String> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err("branch must not be empty".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("branch must not be dot path".to_string());
    }
    Ok(trimmed.to_string())
}

fn resolve_worktree_dir(basedir: &str, branch: &str) -> Result<PathBuf, String> {
    let base = basedir.trim();
    if base.is_empty() {
        return Err("basedir must not be empty".to_string());
    }
    let base_path = PathBuf::from(base);
    let base_path = if base_path.is_absolute() {
        base_path
    } else {
        std::env::current_dir()
            .map_err(|e| format!("resolve current_dir failed: {e}"))?
            .join(base_path)
    };
    Ok(base_path.join(worktree_slug(branch)))
}

fn git_command(args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("git {} failed: {e}", args.join(" ")))
}

fn git_command_in_dir(cwd: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|e| format!("git {} failed: {e}", args.join(" ")))
}

fn ensure_git_root() -> Result<PathBuf, String> {
    let output = git_command(&["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Err(format!(
            "git rev-parse --show-toplevel failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Err("git root is empty".to_string());
    }
    Ok(PathBuf::from(root))
}

fn branch_exists(repo_root: &Path, branch: &str) -> Result<bool, String> {
    let output = git_command_in_dir(
        repo_root,
        &["rev-parse", "--verify", &format!("refs/heads/{branch}")],
    )?;
    Ok(output.status.success())
}

fn run_shell_hook(cwd: &Path, hook: &str, label: &str) -> Result<(), String> {
    let hook = hook.trim();
    if hook.is_empty() {
        return Ok(());
    }
    let output = Command::new(default_shell())
        .current_dir(cwd)
        .arg("-lc")
        .arg(hook)
        .output()
        .map_err(|e| format!("{label} failed to spawn: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "{label} failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

fn copy_ignored_entries(repo_root: &Path, worktree_dir: &Path) -> Result<(), String> {
    let output = git_command_in_dir(
        repo_root,
        &[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ],
    )?;
    if !output.status.success() {
        return Err(format!(
            "git ls-files for ignored entries failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("parse ignored entries output failed: {e}"))?;
    for line in stdout.lines() {
        let entry = line.trim().trim_end_matches('/');
        if entry.is_empty() {
            continue;
        }
        let from = repo_root.join(entry);
        if !from.exists() {
            continue;
        }
        let to = worktree_dir.join(entry);
        if from.is_dir() {
            copy_dir_recursive_if_missing(&from, &to)?;
            continue;
        }
        if to.exists() {
            continue;
        }
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
        }
        fs::copy(&from, &to).map_err(|e| {
            format!(
                "copy ignored file failed: {} -> {}: {e}",
                from.display(),
                to.display()
            )
        })?;
    }
    Ok(())
}

fn copy_dir_recursive_if_missing(from: &Path, to: &Path) -> Result<(), String> {
    if !to.exists() {
        fs::create_dir_all(to).map_err(|e| format!("create dir failed: {e}"))?;
    }
    for entry in fs::read_dir(from).map_err(|e| format!("read dir failed: {e}"))? {
        let entry = entry.map_err(|e| format!("read dir entry failed: {e}"))?;
        let child_from = entry.path();
        let child_to = to.join(entry.file_name());
        if child_from.is_dir() {
            copy_dir_recursive_if_missing(&child_from, &child_to)?;
            continue;
        }
        if child_to.exists() {
            continue;
        }
        fs::copy(&child_from, &child_to).map_err(|e| {
            format!(
                "copy ignored file failed: {} -> {}: {e}",
                child_from.display(),
                child_to.display()
            )
        })?;
    }
    Ok(())
}

fn ensure_worktree_created(
    repo_root: &Path,
    branch: &str,
    basedir: &str,
    copyignored: bool,
    hook: Option<&str>,
) -> Result<(PathBuf, bool), String> {
    let worktree_dir = resolve_worktree_dir(basedir, branch)?;
    if worktree_dir.exists() {
        return Ok((worktree_dir, false));
    }
    if let Some(parent) = worktree_dir.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create basedir failed: {e}"))?;
    }

    let worktree_dir_str = worktree_dir.to_string_lossy().to_string();
    let output = if branch_exists(repo_root, branch)? {
        git_command_in_dir(repo_root, &["worktree", "add", &worktree_dir_str, branch])?
    } else {
        git_command_in_dir(
            repo_root,
            &["worktree", "add", "-b", branch, &worktree_dir_str],
        )?
    };
    if !output.status.success() {
        return Err(format!(
            "git worktree add failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    if copyignored {
        copy_ignored_entries(repo_root, &worktree_dir)?;
    }
    if let Some(hook) = hook {
        run_shell_hook(&worktree_dir, hook, "hook")?;
    }
    Ok((worktree_dir, true))
}

fn remove_worktree(
    repo_root: &Path,
    worktree_dir: &Path,
    deletehook: Option<&str>,
    force: bool,
) -> Result<bool, String> {
    if !worktree_dir.exists() {
        return Ok(false);
    }
    if let Some(hook) = deletehook {
        run_shell_hook(worktree_dir, hook, "deletehook")?;
    }
    let mut args = vec![
        "worktree".to_string(),
        "remove".to_string(),
        worktree_dir.to_string_lossy().to_string(),
    ];
    if force {
        args.push("--force".to_string());
    }
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = git_command_in_dir(repo_root, &arg_refs)?;
    if !output.status.success() {
        return Err(format!(
            "git worktree remove failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(true)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn lifecycle_key(task_id: &str, member: &str) -> String {
    format!("{}::{}", task_id.trim(), member.trim())
}

fn linear_route_key(issue_id: &str, member: &str) -> String {
    lifecycle_key(issue_id, member)
}

fn validate_monitoring_identity(task_id: &str, member: &str) -> Result<(), String> {
    if task_id.trim().is_empty() {
        return Err("task_id must not be empty".to_string());
    }
    if member.trim().is_empty() {
        return Err("member must not be empty".to_string());
    }
    Ok(())
}

fn first_mentioned_member(body: &str) -> Option<String> {
    for token in body.split_whitespace() {
        let candidate = token.trim().trim_matches(|ch: char| {
            matches!(
                ch,
                ':' | ',' | '.' | ';' | '!' | '?' | '(' | ')' | '[' | ']' | '{' | '}'
            )
        });
        if let Some(stripped) = candidate.strip_prefix('@') {
            let member = stripped.trim();
            if !member.is_empty() {
                return Some(member.to_string());
            }
        }
    }
    None
}

fn normalize_linear_body(body: &str, member: &str) -> String {
    let trimmed = body.trim();
    let direct_prefix = format!("@{member}");
    if let Some(rest) = trimmed.strip_prefix(&direct_prefix) {
        return rest.trim_start_matches([':', '-', ' ']).trim().to_string();
    }
    trimmed.to_string()
}

fn normalize_linear_comment(
    comment: LinearCommentEnvelope,
    fallback_source: &str,
) -> Result<NormalizedLinearMessage, LinearCommentParseError> {
    let issue_id = comment.issue_id.trim().to_string();
    if issue_id.is_empty() {
        return Err(LinearCommentParseError::EmptyIssueId);
    }
    if comment.body.trim().is_empty() {
        return Err(LinearCommentParseError::EmptyBody);
    }

    let target_member = comment
        .target_member
        .as_deref()
        .and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| first_mentioned_member(&comment.body))
        .ok_or(LinearCommentParseError::MissingTargetMember)?;
    let source = comment
        .source
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback_source)
        .to_string();
    let event_key = comment
        .comment_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|id| format!("linear:{}:{id}", issue_id))
        .unwrap_or_else(|| {
            let compact_body = comment.body.trim().replace('\n', "\\n");
            format!("linear:{}:{}:{}", issue_id, target_member, compact_body)
        });
    let body = normalize_linear_body(&comment.body, &target_member);
    if body.is_empty() {
        return Err(LinearCommentParseError::EmptyNormalizedBody);
    }

    Ok(NormalizedLinearMessage {
        issue_id,
        target_member,
        body,
        source,
        event_key,
    })
}

fn validate_monitoring_token(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} must not be empty"));
    }
    if trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
    {
        return Ok(trimmed.to_string());
    }
    Err(format!(
        "{field} must contain only [A-Za-z0-9._-] for hook-safe command generation"
    ))
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn monitor_script_path(worktree_dir: &Path) -> PathBuf {
    worktree_dir.join(COCKPIT_HOOK_SCRIPT_RELATIVE_PATH)
}

fn claude_settings_path(worktree_dir: &Path) -> PathBuf {
    worktree_dir.join(COCKPIT_CLAUDE_SETTINGS_RELATIVE_PATH)
}

fn claude_log_file_path(cockpit_root: &Path, task_id: &str) -> PathBuf {
    cockpit_root
        .join("logs")
        .join("codex")
        .join(task_id)
        .join("claude-hooks.jsonl")
}

fn claude_hook_script_body() -> String {
    format!(
        r#"#!/bin/sh
set -eu
if [ "$#" -lt 5 ]; then
  exit 1
fi
log_file="$1"
task_id="$2"
member="$3"
state="$4"
hook_event="$5"
mkdir -p "$(dirname "$log_file")"
if [ ! -t 0 ]; then
  cat >/dev/null || true
fi
timestamp="$(date +%s 2>/dev/null || printf '0')"
printf '{{"source":"{}","task_id":"%s","member":"%s","state":"%s","hook_event":"%s","timestamp":%s}}\n' \
  "$task_id" "$member" "$state" "$hook_event" "$timestamp" >> "$log_file"
"#,
        COCKPIT_HOOK_SOURCE
    )
}

fn write_file_if_changed(path: &Path, body: &[u8]) -> Result<(), String> {
    if let Ok(current) = fs::read(path) {
        if current == body {
            return Ok(());
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent failed: {e}"))?;
    }
    fs::write(path, body).map_err(|e| format!("write failed for {}: {e}", path.display()))
}

fn command_for_hook(
    script_path: &Path,
    log_file_path: &Path,
    task_id: &str,
    member: &str,
    spec: &ClaudeHookSpec,
) -> String {
    format!(
        "{} {} {} {} {}",
        shell_quote(script_path.to_string_lossy().as_ref()),
        shell_quote(log_file_path.to_string_lossy().as_ref()),
        shell_quote(task_id),
        shell_quote(member),
        shell_quote(spec.state),
    ) + &format!(" {}", shell_quote(spec.event_name))
}

fn is_cockpit_hook_entry(value: &serde_json::Value) -> bool {
    value
        .get("hooks")
        .and_then(|raw| raw.as_array())
        .map(|hooks| {
            hooks.iter().any(|hook| {
                let hook_type = hook.get("type").and_then(|v| v.as_str());
                let command = hook.get("command").and_then(|v| v.as_str());
                hook_type == Some("command")
                    && command
                        .map(|cmd| cmd.contains(COCKPIT_HOOK_SCRIPT_RELATIVE_PATH))
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn upsert_claude_settings(
    settings_path: &Path,
    script_path: &Path,
    log_file_path: &Path,
    task_id: &str,
    member: &str,
) -> Result<(), String> {
    let existing = if settings_path.exists() {
        let bytes = fs::read(settings_path)
            .map_err(|e| format!("read settings failed for {}: {e}", settings_path.display()))?;
        serde_json::from_slice::<serde_json::Value>(&bytes)
            .map_err(|e| format!("parse settings failed for {}: {e}", settings_path.display()))?
    } else {
        serde_json::json!({})
    };

    let root = existing
        .as_object()
        .cloned()
        .ok_or_else(|| format!("{} must be a JSON object", settings_path.display()))?;
    let mut root = serde_json::Map::from_iter(root);
    let hooks = root
        .entry("hooks".to_string())
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks
        .as_object_mut()
        .ok_or_else(|| format!("{} hooks must be an object", settings_path.display()))?;

    for spec in CLAUDE_HOOK_SPECS {
        let entry = hooks_obj
            .entry(spec.event_name.to_string())
            .or_insert_with(|| serde_json::json!([]));
        let events = entry.as_array_mut().ok_or_else(|| {
            format!(
                "{} hooks.{} must be an array",
                settings_path.display(),
                spec.event_name
            )
        })?;
        events.retain(|item| !is_cockpit_hook_entry(item));
        events.push(serde_json::json!({
            "hooks": [
                {
                    "type": "command",
                    "command": command_for_hook(script_path, log_file_path, task_id, member, &spec),
                }
            ]
        }));
    }

    let body = serde_json::to_vec_pretty(&serde_json::Value::Object(root))
        .map_err(|e| format!("serialize settings failed: {e}"))?;
    let mut body_with_newline = body;
    body_with_newline.push(b'\n');
    write_file_if_changed(settings_path, &body_with_newline)
}

fn ensure_claude_worktree_hooks(
    worktree_dir: &Path,
    task_id: &str,
    member: &str,
    cockpit_root: &Path,
) -> Result<ClaudeWorktreeHooksResponse, String> {
    validate_monitoring_identity(task_id, member)?;
    let task_id = validate_monitoring_token(task_id, "task_id")?;
    let member = validate_monitoring_token(member, "member")?;
    if !worktree_dir.exists() || !worktree_dir.is_dir() {
        return Err(format!(
            "worktree_dir must be an existing directory: {}",
            worktree_dir.display()
        ));
    }

    let script_path = monitor_script_path(worktree_dir);
    let settings_path = claude_settings_path(worktree_dir);
    let log_file_path = claude_log_file_path(cockpit_root, &task_id);

    write_file_if_changed(&script_path, claude_hook_script_body().as_bytes())?;
    #[cfg(unix)]
    {
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("chmod failed for {}: {e}", script_path.display()))?;
    }
    upsert_claude_settings(
        &settings_path,
        &script_path,
        &log_file_path,
        &task_id,
        &member,
    )?;

    Ok(ClaudeWorktreeHooksResponse {
        settings_path: settings_path.to_string_lossy().to_string(),
        hook_script_path: script_path.to_string_lossy().to_string(),
        log_file_path: log_file_path.to_string_lossy().to_string(),
    })
}

fn is_valid_registered_transition(
    from: Option<TaskLifecycleState>,
    to: TaskLifecycleState,
) -> bool {
    match from {
        None => matches!(to, TaskLifecycleState::Sent | TaskLifecycleState::Failed),
        Some(TaskLifecycleState::Sent) => {
            matches!(
                to,
                TaskLifecycleState::Sent | TaskLifecycleState::Ack | TaskLifecycleState::Failed
            )
        }
        Some(TaskLifecycleState::Ack) => {
            matches!(
                to,
                TaskLifecycleState::Ack
                    | TaskLifecycleState::InProgress
                    | TaskLifecycleState::Failed
            )
        }
        Some(TaskLifecycleState::InProgress) => {
            matches!(
                to,
                TaskLifecycleState::InProgress
                    | TaskLifecycleState::Done
                    | TaskLifecycleState::Failed
            )
        }
        Some(TaskLifecycleState::Done) => matches!(to, TaskLifecycleState::Done),
        Some(TaskLifecycleState::Failed) => matches!(to, TaskLifecycleState::Failed),
    }
}

#[cfg(not(test))]
fn log_monitoring_event(value: serde_json::Value) {
    eprintln!("[monitoring] {}", value);
    let path = Path::new("logs/monitoring/lifecycle.jsonl");
    if let Some(parent) = path.parent() {
        if create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{value}");
    }
}

#[cfg(test)]
fn log_monitoring_event(_value: serde_json::Value) {}

#[cfg(not(test))]
fn log_monitoring_runner_event(value: serde_json::Value) {
    eprintln!("[monitoring-runner] {}", value);
    let path = Path::new("logs/monitoring/runner.jsonl");
    if let Some(parent) = path.parent() {
        if create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{value}");
    }
}

#[cfg(test)]
fn log_monitoring_runner_event(_value: serde_json::Value) {}

#[cfg(not(test))]
fn log_linear_message_event(value: serde_json::Value) {
    eprintln!("[linear-messaging] {}", value);
    let path = Path::new("logs/monitoring/linear-messaging.jsonl");
    if let Some(parent) = path.parent() {
        if create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{value}");
    }
}

#[cfg(test)]
fn log_linear_message_event(_value: serde_json::Value) {}

fn monitoring_member_fallback() -> String {
    std::env::var("COCKPIT_MONITORING_MEMBER").unwrap_or_else(|_| "MemberA".to_string())
}

fn normalize_lifecycle_state(value: &str) -> Option<TaskLifecycleState> {
    match value.trim().to_ascii_lowercase().as_str() {
        "sent" | "queued" => Some(TaskLifecycleState::Sent),
        "ack" | "acknowledged" | "stop" | "waiting" | "human_turn" | "human-turn" => {
            Some(TaskLifecycleState::Ack)
        }
        "in_progress" | "in-progress" | "running" | "executing" | "pretooluse" | "posttooluse"
        | "tool_running" | "tool-running" => Some(TaskLifecycleState::InProgress),
        "done" | "completed" | "complete" | "finished" | "success" | "succeeded"
        | "taskcompleted" => Some(TaskLifecycleState::Done),
        "failed" | "error" | "posttoolusefailure" => Some(TaskLifecycleState::Failed),
        _ => None,
    }
}

fn parse_state_from_leader_report(body: &str) -> Option<TaskLifecycleState> {
    let normalized = body.to_ascii_lowercase();
    if normalized.contains(" in_review")
        || normalized.starts_with("in_review")
        || normalized.contains(" in_progress")
        || normalized.contains(" in progress")
        || normalized.starts_with("in_progress")
        || normalized.starts_with("in progress")
    {
        return Some(TaskLifecycleState::InProgress);
    }
    if normalized.contains(" done") || normalized.starts_with("done") {
        return Some(TaskLifecycleState::Done);
    }
    if normalized.contains(" blocked")
        || normalized.contains(" failed")
        || normalized.contains(" fail")
        || normalized.starts_with("failed")
    {
        return Some(TaskLifecycleState::Failed);
    }
    if normalized.contains(" ack") || normalized.starts_with("ack ") {
        return Some(TaskLifecycleState::Ack);
    }
    None
}

fn parse_task_id_from_leader_report(body: &str) -> Option<String> {
    let mut parts = body.split_whitespace();
    let raw = parts.next()?;
    let task_id = raw
        .trim_matches(|c: char| matches!(c, ',' | '.' | ':' | ';' | '(' | ')' | '[' | ']'))
        .to_ascii_uppercase();
    if task_id.starts_with("CON-") {
        return Some(task_id);
    }
    None
}

fn json_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(raw) = value.get(*key) {
            if let Some(s) = raw.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn extract_task_id(path: &Path, value: &serde_json::Value) -> Option<String> {
    if let Some(task_id) = json_string(value, &["task_id", "taskId", "issue_id", "issueId"]) {
        return Some(task_id);
    }

    let mut components = path.components().peekable();
    while let Some(component) = components.next() {
        if component.as_os_str() == "codex" {
            if let Some(task_id) = components.next() {
                let task_id = task_id.as_os_str().to_string_lossy().trim().to_string();
                if !task_id.is_empty() {
                    return Some(task_id);
                }
            }
        }
    }
    None
}

fn extract_member(value: &serde_json::Value) -> String {
    json_string(value, &["member", "agent", "delegate", "assignee", "owner"])
        .unwrap_or_else(monitoring_member_fallback)
}

fn extract_state(value: &serde_json::Value) -> Option<TaskLifecycleState> {
    if let Some(raw) = json_string(value, &["hook_event_name", "hookEventName"]) {
        if let Some(state) = normalize_lifecycle_state(&raw) {
            return Some(state);
        }
    }
    for key in [
        "state",
        "lifecycle_state",
        "lifecycleState",
        "status",
        "hook_event",
        "hookEvent",
        "event",
        "type",
    ] {
        if let Some(raw) = value.get(key).and_then(|v| v.as_str()) {
            if let Some(state) = normalize_lifecycle_state(raw) {
                return Some(state);
            }
        }
    }
    None
}

fn build_runner_event(
    path: &Path,
    offset: u64,
    line: &str,
) -> Result<Option<MonitoringRunnerEvent>, String> {
    let payload: serde_json::Value = serde_json::from_str(line).map_err(|e| {
        MonitoringRunnerParseError::InvalidJson(e.to_string()).to_string()
    })?;
    if let Ok(envelope) = serde_json::from_value::<CodexEventEnvelope>(payload.clone()) {
        if envelope.event_type == "item.completed" {
            if let Some(item) = envelope.item {
                if item.item_type == "agent_message" {
                    if let Some(text) = item.text {
                        if let Some(body) = text.trim().strip_prefix("@Leader:") {
                            let body = body.trim();
                            if let (Some(task_id), Some(state)) = (
                                parse_task_id_from_leader_report(body),
                                parse_state_from_leader_report(body),
                            ) {
                                let member = monitoring_member_fallback();
                                let dedupe_key =
                                    Some(format!("{}:{offset}", path.to_string_lossy()));
                                return Ok(Some(MonitoringRunnerEvent {
                                    request: LifecycleIngestRequest {
                                        task_id,
                                        member,
                                        state,
                                        message_id: Some(dedupe_key.clone().unwrap_or_default()),
                                        dedupe_key,
                                        source: Some("backend_runner".to_string()),
                                    },
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    let state = match extract_state(&payload) {
        Some(state) => state,
        None => {
            log_monitoring_runner_event(serde_json::json!({
                "event": "runner_event_ignored",
                "reason": format!("{:?}", MonitoringRunnerIgnoreReason::NonLifecyclePayload),
                "path": path.to_string_lossy(),
                "offset": offset,
            }));
            return Ok(None);
        }
    };
    let task_id = match extract_task_id(path, &payload) {
        Some(task_id) => task_id,
        None => {
            log_monitoring_runner_event(serde_json::json!({
                "event": "runner_event_ignored",
                "reason": format!("{:?}", MonitoringRunnerIgnoreReason::MissingTaskId),
                "path": path.to_string_lossy(),
                "offset": offset,
            }));
            return Ok(None);
        }
    };
    let member = extract_member(&payload);
    let source = json_string(&payload, &["source"]).unwrap_or_else(|| "backend_runner".to_string());
    let message_id = json_string(&payload, &["id", "event_id", "message_id", "messageId"]);
    let dedupe_key = Some(format!("{}:{offset}", path.to_string_lossy()));

    Ok(Some(MonitoringRunnerEvent {
        request: LifecycleIngestRequest {
            task_id,
            member,
            state,
            message_id,
            dedupe_key,
            source: Some(source),
        },
    }))
}

fn collect_codex_log_files(root: &Path, out: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_codex_log_files(&path, out);
            continue;
        }
        if !path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("jsonl"))
            .unwrap_or(false)
        {
            continue;
        }
        out.push(path);
    }
}

fn read_runner_offsets(path: &Path) -> MonitoringRunnerOffsets {
    if let Ok(bytes) = fs::read(path) {
        if let Ok(offsets) = serde_json::from_slice::<MonitoringRunnerOffsets>(&bytes) {
            return offsets;
        }
    }
    MonitoringRunnerOffsets::default()
}

fn write_runner_offsets(path: &Path, offsets: &MonitoringRunnerOffsets) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create runner offset parent failed: {e}"))?;
    }
    let body = serde_json::to_vec_pretty(offsets)
        .map_err(|e| format!("serialize runner offsets failed: {e}"))?;
    fs::write(path, body).map_err(|e| format!("write runner offsets failed: {e}"))
}

fn retry_delay_ms(attempt: u32) -> u64 {
    let capped = attempt.min(6);
    500 * (1_u64 << capped)
}

fn monitoring_input_dir(cwd: &Path) -> PathBuf {
    std::env::var("COCKPIT_MONITORING_INPUT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| cwd.join("logs/codex"))
}

fn monitoring_offsets_file(cwd: &Path) -> PathBuf {
    std::env::var("COCKPIT_MONITORING_OFFSETS_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| cwd.join("logs/monitoring/runner-offsets.json"))
}

impl PtyManager {
    fn register_linear_route(&self, pty_id: &str, issue_id: &str, member: &str) -> Result<(), String> {
        validate_monitoring_identity(issue_id, member)?;
        let route_key = linear_route_key(issue_id, member);
        let mut routes = self
            .routes
            .lock()
            .map_err(|_| "failed to lock pty routes".to_string())?;
        routes.insert(route_key, pty_id.to_string());
        Ok(())
    }

    fn remove_linear_route(&self, issue_id: &str, member: &str, pty_id: &str) -> Result<(), String> {
        let route_key = linear_route_key(issue_id, member);
        let mut routes = self
            .routes
            .lock()
            .map_err(|_| "failed to lock pty routes".to_string())?;
        if routes.get(&route_key).is_some_and(|registered| registered == pty_id) {
            routes.remove(&route_key);
        }
        Ok(())
    }

    fn route_linear_message(&self, msg: &NormalizedLinearMessage) -> Result<Option<String>, String> {
        let route_key = linear_route_key(&msg.issue_id, &msg.target_member);
        let pty_id = {
            let routes = self
                .routes
                .lock()
                .map_err(|_| "failed to lock pty routes".to_string())?;
            routes.get(&route_key).cloned()
        };
        let Some(pty_id) = pty_id else {
            return Ok(None);
        };

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "failed to lock sessions".to_string())?;
        let session = sessions
            .get_mut(&pty_id)
            .ok_or_else(|| format!("pty not found for route: {}", route_key))?;
        session
            .writer
            .write_all(msg.body.as_bytes())
            .map_err(|e| format!("linear route write failed: {e}"))?;
        session
            .writer
            .write_all(b"\n")
            .map_err(|e| format!("linear route write newline failed: {e}"))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("linear route flush failed: {e}"))?;

        Ok(Some(pty_id))
    }
}

impl MonitoringManager {
    fn start_runner_if_needed(&self, app: &AppHandle) -> Result<(), String> {
        let mut started = self
            .runner_started
            .lock()
            .map_err(|_| "failed to lock runner started state".to_string())?;
        if *started {
            return Ok(());
        }
        *started = true;
        let manager = self.clone();
        let app = app.clone();
        thread::spawn(move || {
            manager.run_runner_loop(app);
        });
        Ok(())
    }

    fn run_runner_loop(&self, app: AppHandle) {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let input_dir = monitoring_input_dir(&cwd);
        let offsets_path = monitoring_offsets_file(&cwd);
        let persisted = read_runner_offsets(&offsets_path);
        let mut cursor = MonitoringRunnerCursor {
            offsets: persisted.files,
            pending: HashMap::new(),
        };

        log_monitoring_runner_event(serde_json::json!({
            "event": "runner_started",
            "cwd": cwd.to_string_lossy(),
            "input_dir": input_dir.to_string_lossy(),
            "offsets_path": offsets_path.to_string_lossy(),
        }));

        let mut attempt: u32 = 0;
        loop {
            match self.run_runner_cycle(&app, &input_dir, &offsets_path, &mut cursor) {
                Ok(processed) => {
                    if attempt > 0 {
                        log_monitoring_runner_event(serde_json::json!({
                            "event": "runner_recovered",
                            "attempt": attempt,
                            "processed_events": processed,
                        }));
                    }
                    attempt = 0;
                }
                Err(error) => {
                    attempt = attempt.saturating_add(1);
                    let delay_ms = retry_delay_ms(attempt);
                    log_monitoring_runner_event(serde_json::json!({
                        "event": "runner_retry",
                        "attempt": attempt,
                        "delay_ms": delay_ms,
                        "error": error,
                    }));
                    thread::sleep(Duration::from_millis(delay_ms));
                    continue;
                }
            }
            thread::sleep(Duration::from_millis(1000));
        }
    }

    fn run_runner_cycle(
        &self,
        app: &AppHandle,
        input_dir: &Path,
        offsets_path: &Path,
        cursor: &mut MonitoringRunnerCursor,
    ) -> Result<usize, String> {
        let mut files = Vec::new();
        collect_codex_log_files(input_dir, &mut files);
        files.sort();

        let mut processed_events = 0_usize;
        for file in files {
            let key = file.to_string_lossy().to_string();
            let mut previous_offset = *cursor.offsets.get(&key).unwrap_or(&0);
            let metadata = fs::metadata(&file)
                .map_err(|e| format!("metadata failed for {}: {e}", file.display()))?;
            if previous_offset > metadata.len() {
                previous_offset = 0;
                cursor.pending.remove(&key);
                log_monitoring_runner_event(serde_json::json!({
                    "event": "runner_file_truncated",
                    "file": key,
                }));
            }

            let mut file_handle = File::open(&file)
                .map_err(|e| format!("open failed for {}: {e}", file.display()))?;
            file_handle
                .seek(SeekFrom::Start(previous_offset))
                .map_err(|e| format!("seek failed for {}: {e}", file.display()))?;

            let mut bytes = Vec::new();
            file_handle
                .read_to_end(&mut bytes)
                .map_err(|e| format!("read failed for {}: {e}", file.display()))?;

            let next_offset = previous_offset.saturating_add(bytes.len() as u64);
            let mut buffer = cursor.pending.remove(&key).unwrap_or_default();
            buffer.extend(bytes);

            let mut start = 0_usize;
            for (idx, byte) in buffer.iter().enumerate() {
                if *byte != b'\n' {
                    continue;
                }
                let line = std::str::from_utf8(&buffer[start..idx])
                    .map_err(|e| format!("invalid utf8 line for {}: {e}", file.display()))?;
                let line_offset = previous_offset + idx as u64;
                if let Some(event) = build_runner_event(&file, line_offset, line)? {
                    let now = now_millis();
                    let response = {
                        let mut state = self
                            .state
                            .lock()
                            .map_err(|_| "failed to lock monitoring state".to_string())?;
                        state.ingest(event.request, now)
                    };
                    let _ = app.emit("monitoring-lifecycle", &response);
                    processed_events = processed_events.saturating_add(1);
                }
                start = idx + 1;
            }

            if start < buffer.len() {
                cursor.pending.insert(key.clone(), buffer[start..].to_vec());
            }
            cursor.offsets.insert(key, next_offset);
        }

        write_runner_offsets(
            offsets_path,
            &MonitoringRunnerOffsets {
                files: cursor.offsets.clone(),
            },
        )?;
        Ok(processed_events)
    }
}

impl MonitoringState {
    fn register_definition(
        &mut self,
        req: TaskRegistrationRequest,
    ) -> Result<TaskLifecycleSnapshot, String> {
        validate_monitoring_identity(&req.task_id, &req.member)?;
        let key = lifecycle_key(&req.task_id, &req.member);
        let definition = self.task_definitions.entry(key.clone()).or_default();

        if req.title.is_some() {
            definition.title = req.title;
        }
        if req.dedupe_key.is_some() {
            definition.dedupe_key = req.dedupe_key;
        }
        definition.auto_registered = false;

        let lifecycle = self.task_states.get(&key);
        Ok(TaskLifecycleSnapshot {
            task_id: req.task_id.trim().to_string(),
            member: req.member.trim().to_string(),
            title: definition.title.clone(),
            dedupe_key: definition.dedupe_key.clone(),
            state: lifecycle.map(|record| record.state),
            last_event_id: lifecycle.and_then(|record| record.last_event_id.clone()),
            updated_at_ms: lifecycle.map(|record| record.updated_at_ms),
            history_len: lifecycle.map_or(0, |record| record.history_len),
        })
    }

    fn transition_registered(
        &mut self,
        req: TaskLifecycleTransitionRequest,
        now: u64,
    ) -> Result<TaskLifecycleSnapshot, String> {
        validate_monitoring_identity(&req.task_id, &req.member)?;
        let task_id = req.task_id.trim().to_string();
        let member = req.member.trim().to_string();
        let key = lifecycle_key(&task_id, &member);
        let definition = self.task_definitions.get(&key).cloned().ok_or_else(|| {
            format!(
                "task registration not found for task_id={} member={}",
                task_id, member
            )
        })?;

        let current_state = self.task_states.get(&key).map(|record| record.state);
        if !is_valid_registered_transition(current_state, req.state) {
            return Err(format!(
                "invalid lifecycle transition for task_id={} member={} to {:?}",
                task_id, member, req.state
            ));
        }

        let dedupe_key = req.dedupe_key.clone().or_else(|| {
            definition
                .dedupe_key
                .as_ref()
                .map(|base| format!("{base}:{:?}:{now}", req.state))
        });
        let message_id = req.message_id.clone().or_else(|| dedupe_key.clone());
        let response = self.ingest(
            LifecycleIngestRequest {
                task_id: task_id.clone(),
                member: member.clone(),
                state: req.state,
                message_id,
                dedupe_key,
                source: req.source,
            },
            now,
        );

        if response.decision == LifecycleDecision::Stale {
            return Err(format!(
                "invalid lifecycle transition for task_id={} member={} to {:?}",
                task_id, member, req.state
            ));
        }

        let lifecycle = self.task_states.get(&key);
        Ok(TaskLifecycleSnapshot {
            task_id,
            member,
            title: definition.title.clone(),
            dedupe_key: definition.dedupe_key.clone(),
            state: lifecycle.map(|record| record.state),
            last_event_id: lifecycle.and_then(|record| record.last_event_id.clone()),
            updated_at_ms: lifecycle.map(|record| record.updated_at_ms),
            history_len: lifecycle.map_or(0, |record| record.history_len),
        })
    }

    fn get_registered_lifecycle(
        &self,
        req: TaskLifecycleLookupRequest,
    ) -> Result<TaskLifecycleSnapshot, String> {
        validate_monitoring_identity(&req.task_id, &req.member)?;
        let task_id = req.task_id.trim().to_string();
        let member = req.member.trim().to_string();
        let key = lifecycle_key(&task_id, &member);
        let definition = self.task_definitions.get(&key).ok_or_else(|| {
            format!(
                "task registration not found for task_id={} member={}",
                task_id, member
            )
        })?;
        let lifecycle = self.task_states.get(&key);

        Ok(TaskLifecycleSnapshot {
            task_id,
            member,
            title: definition.title.clone(),
            dedupe_key: definition.dedupe_key.clone(),
            state: lifecycle.map(|record| record.state),
            last_event_id: lifecycle.and_then(|record| record.last_event_id.clone()),
            updated_at_ms: lifecycle.map(|record| record.updated_at_ms),
            history_len: lifecycle.map_or(0, |record| record.history_len),
        })
    }

    fn ingest(&mut self, req: LifecycleIngestRequest, now: u64) -> LifecycleIngestResponse {
        let event_key = req.event_key();
        let key = lifecycle_key(&req.task_id, &req.member);
        self.task_definitions
            .entry(key.clone())
            .or_insert_with(|| TaskDefinitionRecord {
                title: None,
                dedupe_key: None,
                auto_registered: true,
            });

        if self.seen_event_keys.contains(&event_key) {
            let fallback_state = req.state;
            let (current_state, updated_at_ms) = self
                .task_states
                .get(&key)
                .map(|record| (record.state, record.updated_at_ms))
                .unwrap_or((fallback_state, now));
            return LifecycleIngestResponse {
                decision: LifecycleDecision::Duplicate,
                task_id: req.task_id,
                member: req.member,
                current_state,
                event_key,
                updated_at_ms,
            };
        }

        self.seen_event_keys.insert(event_key.clone());
        let mut previous_state: Option<TaskLifecycleState> = None;
        let mut decision = LifecycleDecision::Applied;
        let record = self
            .task_states
            .entry(key)
            .or_insert_with(|| TaskLifecycleRecord {
                task_id: req.task_id.clone(),
                member: req.member.clone(),
                state: req.state,
                last_event_id: req.message_id.clone(),
                updated_at_ms: now,
                history_len: 0,
            });

        if record.history_len > 0 {
            previous_state = Some(record.state);
            let stale = record.state.is_terminal()
                || req.state.rank() < record.state.rank()
                || (req.state.rank() == record.state.rank() && req.state != record.state);
            if stale {
                decision = LifecycleDecision::Stale;
            }
        }

        if decision == LifecycleDecision::Applied {
            record.state = req.state;
            record.last_event_id = req.message_id.clone();
            record.updated_at_ms = now;
        }
        record.history_len += 1;

        log_monitoring_event(serde_json::json!({
            "event": "lifecycle_ingest",
            "registration_mode": self
                .task_definitions
                .get(&lifecycle_key(&record.task_id, &record.member))
                .map(|definition| if definition.auto_registered { "auto" } else { "manual" })
                .unwrap_or("unknown"),
            "decision": decision,
            "task_id": req.task_id,
            "member": req.member,
            "source": req.source.unwrap_or_else(|| "backend".to_string()),
            "message_id": req.message_id,
            "event_key": event_key,
            "previous_state": previous_state,
            "current_state": record.state,
            "updated_at_ms": record.updated_at_ms,
            "history_len": record.history_len,
        }));

        LifecycleIngestResponse {
            decision,
            task_id: record.task_id.clone(),
            member: record.member.clone(),
            current_state: record.state,
            event_key,
            updated_at_ms: record.updated_at_ms,
        }
    }

    fn get_state(&self, task_id: &str, member: &str) -> Option<LifecycleStateResponse> {
        let key = lifecycle_key(task_id, member);
        self.task_states
            .get(&key)
            .map(|record| LifecycleStateResponse {
                task_id: record.task_id.clone(),
                member: record.member.clone(),
                state: record.state,
                last_event_id: record.last_event_id.clone(),
                updated_at_ms: record.updated_at_ms,
                history_len: record.history_len,
            })
    }
}

fn ingest_linear_comment(
    monitoring_manager: &MonitoringManager,
    pty_manager: &PtyManager,
    comment: LinearCommentEnvelope,
    fallback_source: &str,
) -> Result<LinearMessageIngestResponse, String> {
    let message = normalize_linear_comment(comment, fallback_source).map_err(|e| e.to_string())?;

    {
        let mut state = monitoring_manager
            .state
            .lock()
            .map_err(|_| "failed to lock monitoring state".to_string())?;
        if state.seen_linear_event_keys.contains(&message.event_key) {
            let response = LinearMessageIngestResponse {
                decision: LinearMessageDecision::Duplicate,
                issue_id: message.issue_id.clone(),
                target_member: message.target_member.clone(),
                normalized_body: message.body.clone(),
                source: message.source.clone(),
                pty_id: None,
                event_key: message.event_key.clone(),
            };
            log_linear_message_event(serde_json::json!({
                "event": "linear_comment_ingest",
                "decision": response.decision,
                "issue_id": response.issue_id,
                "target_member": response.target_member,
                "source": response.source,
                "event_key": response.event_key,
                "reason": "duplicate",
            }));
            return Ok(response);
        }
        state.seen_linear_event_keys.insert(message.event_key.clone());
    }

    let routed_pty_id = pty_manager.route_linear_message(&message)?;
    let decision = if routed_pty_id.is_some() {
        LinearMessageDecision::Delivered
    } else {
        LinearMessageDecision::Unroutable
    };

    let response = LinearMessageIngestResponse {
        decision,
        issue_id: message.issue_id.clone(),
        target_member: message.target_member.clone(),
        normalized_body: message.body.clone(),
        source: message.source.clone(),
        pty_id: routed_pty_id.clone(),
        event_key: message.event_key.clone(),
    };
    log_linear_message_event(serde_json::json!({
        "event": "linear_comment_ingest",
        "decision": response.decision,
        "issue_id": response.issue_id,
        "target_member": response.target_member,
        "source": response.source,
        "pty_id": response.pty_id,
        "event_key": response.event_key,
    }));
    Ok(response)
}

#[tauri::command]
fn claude_prepare_worktree_hooks(
    req: ClaudeWorktreeHooksRequest,
) -> Result<ClaudeWorktreeHooksResponse, String> {
    let worktree_dir = PathBuf::from(req.worktree_dir.trim());
    let worktree_dir = if worktree_dir.is_absolute() {
        worktree_dir
    } else {
        std::env::current_dir()
            .map_err(|e| format!("resolve current_dir failed: {e}"))?
            .join(worktree_dir)
    };
    let cockpit_root =
        std::env::current_dir().map_err(|e| format!("resolve current_dir failed: {e}"))?;
    ensure_claude_worktree_hooks(&worktree_dir, &req.task_id, &req.member, &cockpit_root)
}

#[tauri::command]
fn pty_create(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    req: PtyCreateRequest,
) -> Result<PtyCreateResponse, String> {
    if let (Some(cwd), Some(task_id), Some(member)) = (
        req.cwd.as_deref(),
        req.task_id.as_deref(),
        req.member.as_deref(),
    ) {
        let worktree_dir = Path::new(cwd);
        let worktree_dir = if worktree_dir.is_absolute() {
            worktree_dir.to_path_buf()
        } else {
            std::env::current_dir()
                .map_err(|e| format!("resolve current_dir failed: {e}"))?
                .join(worktree_dir)
        };
        let cockpit_root =
            std::env::current_dir().map_err(|e| format!("resolve current_dir failed: {e}"))?;
        ensure_claude_worktree_hooks(&worktree_dir, task_id, member, &cockpit_root)?;
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(make_pty_size(req.cols, req.rows))
        .map_err(|e| format!("openpty failed: {e}"))?;

    let command = req.command.unwrap_or_else(default_shell);
    let mut command_builder = CommandBuilder::new(command);
    if let Some(args) = req.args {
        for arg in args {
            command_builder.arg(arg);
        }
    }
    if let Some(cwd) = req.cwd {
        command_builder.cwd(cwd);
    }

    let child = pair
        .slave
        .spawn_command(command_builder)
        .map_err(|e| format!("spawn failed: {e}"))?;
    drop(pair.slave);

    let id = manager.next_id.fetch_add(1, Ordering::Relaxed).to_string();
    let event_id = id.clone();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("reader clone failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("writer failed: {e}"))?;
    let app_handle = app.clone();

    let reader_handle = std::thread::spawn(move || {
        let mut buffer = vec![0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let payload = PtyOutputEvent {
                        id: event_id.clone(),
                        data,
                    };
                    if app_handle.emit("pty-output", payload).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let session = PtySession {
        master: pair.master,
        writer,
        child,
        reader: Some(reader_handle),
        task_id: req.task_id.clone(),
        member: req.member.clone(),
    };

    let mut sessions = manager
        .sessions
        .lock()
        .map_err(|_| "failed to lock sessions".to_string())?;
    sessions.insert(id.clone(), session);
    drop(sessions);
    if let (Some(task_id), Some(member)) = (req.task_id.as_deref(), req.member.as_deref()) {
        manager.register_linear_route(&id, task_id, member)?;
    }

    Ok(PtyCreateResponse { id })
}

#[tauri::command]
fn pty_write(manager: State<'_, PtyManager>, req: PtyWriteRequest) -> Result<(), String> {
    let mut sessions = manager
        .sessions
        .lock()
        .map_err(|_| "failed to lock sessions".to_string())?;
    let session = sessions
        .get_mut(&req.id)
        .ok_or_else(|| format!("pty not found: {}", req.id))?;

    session
        .writer
        .write_all(req.data.as_bytes())
        .map_err(|e| format!("write failed: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn pty_resize(manager: State<'_, PtyManager>, req: PtyResizeRequest) -> Result<(), String> {
    let mut sessions = manager
        .sessions
        .lock()
        .map_err(|_| "failed to lock sessions".to_string())?;
    let session = sessions
        .get_mut(&req.id)
        .ok_or_else(|| format!("pty not found: {}", req.id))?;

    session
        .master
        .resize(make_pty_size(req.cols, req.rows))
        .map_err(|e| format!("resize failed: {e}"))?;
    Ok(())
}

#[tauri::command]
fn pty_close(manager: State<'_, PtyManager>, req: PtyCloseRequest) -> Result<(), String> {
    let mut session = {
        let mut sessions = manager
            .sessions
            .lock()
            .map_err(|_| "failed to lock sessions".to_string())?;
        sessions
            .remove(&req.id)
            .ok_or_else(|| format!("pty not found: {}", req.id))?
    };

    let _ = session.child.kill();
    let _ = session.child.wait();
    if let Some(handle) = session.reader.take() {
        let _ = handle.join();
    }
    if let (Some(task_id), Some(member)) = (session.task_id.as_deref(), session.member.as_deref()) {
        manager.remove_linear_route(task_id, member, &req.id)?;
    }
    Ok(())
}

#[tauri::command]
fn worktree_create(req: WorktreeCreateRequest) -> Result<WorktreeLifecycleResponse, String> {
    let branch = validate_worktree_branch(&req.branch)?;
    let repo_root = ensure_git_root()?;
    let _deletehook = req
        .deletehook
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);
    let (worktree_dir, created) = ensure_worktree_created(
        &repo_root,
        &branch,
        &req.basedir,
        req.copyignored.unwrap_or(false),
        req.hook.as_deref(),
    )?;
    let title = branch.clone();
    Ok(WorktreeLifecycleResponse {
        branch,
        worktree_dir: worktree_dir.to_string_lossy().to_string(),
        title,
        created,
        exists: worktree_dir.exists(),
        opened: false,
    })
}

#[tauri::command]
fn worktree_open(
    manager: State<'_, WorktreeManager>,
    req: WorktreeOpenRequest,
) -> Result<WorktreeLifecycleResponse, String> {
    let branch = validate_worktree_branch(&req.branch)?;
    let repo_root = ensure_git_root()?;
    let (worktree_dir, created) = ensure_worktree_created(
        &repo_root,
        &branch,
        &req.basedir,
        req.copyignored.unwrap_or(false),
        req.hook.as_deref(),
    )?;
    let key = worktree_dir.to_string_lossy().to_string();
    let title = branch.clone();
    let mut sessions = manager
        .sessions
        .lock()
        .map_err(|_| "failed to lock worktree sessions".to_string())?;
    sessions.insert(
        key.clone(),
        WorktreeSession {
            key: key.clone(),
            branch: branch.clone(),
            worktree_dir: key.clone(),
            title: title.clone(),
            deletehook: req
                .deletehook
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned),
        },
    );
    Ok(WorktreeLifecycleResponse {
        branch,
        worktree_dir: key,
        title,
        created,
        exists: worktree_dir.exists(),
        opened: true,
    })
}

#[tauri::command]
fn worktree_close(
    manager: State<'_, WorktreeManager>,
    req: WorktreeCloseRequest,
) -> Result<WorktreeCloseResponse, String> {
    let branch = validate_worktree_branch(&req.branch)?;
    let repo_root = ensure_git_root()?;
    let worktree_dir = resolve_worktree_dir(&req.basedir, &branch)?;
    let key = worktree_dir.to_string_lossy().to_string();
    let session = {
        let mut sessions = manager
            .sessions
            .lock()
            .map_err(|_| "failed to lock worktree sessions".to_string())?;
        sessions.remove(&key)
    };
    let title = session
        .as_ref()
        .map(|record| record.title.clone())
        .unwrap_or_else(|| branch.clone());
    let removed = if req.delete_on_close.unwrap_or(false) {
        remove_worktree(
            &repo_root,
            &worktree_dir,
            session
                .as_ref()
                .and_then(|record| record.deletehook.as_deref()),
            req.force.unwrap_or(false),
        )?
    } else {
        false
    };
    Ok(WorktreeCloseResponse {
        branch,
        worktree_dir: key,
        title,
        removed,
    })
}

#[tauri::command]
fn worktree_delete(req: WorktreeDeleteRequest) -> Result<WorktreeDeleteResponse, String> {
    let branch = validate_worktree_branch(&req.branch)?;
    let repo_root = ensure_git_root()?;
    let worktree_dir = resolve_worktree_dir(&req.basedir, &branch)?;
    let removed = remove_worktree(
        &repo_root,
        &worktree_dir,
        req.deletehook.as_deref(),
        req.force.unwrap_or(false),
    )?;
    Ok(WorktreeDeleteResponse {
        branch: branch.clone(),
        worktree_dir: worktree_dir.to_string_lossy().to_string(),
        title: branch,
        removed,
    })
}

#[tauri::command]
fn worktree_title_info(req: WorktreeTitleInfoRequest) -> Result<WorktreeLifecycleResponse, String> {
    let branch = validate_worktree_branch(&req.branch)?;
    let worktree_dir = resolve_worktree_dir(&req.basedir, &branch)?;
    let title = branch.clone();
    Ok(WorktreeLifecycleResponse {
        branch,
        worktree_dir: worktree_dir.to_string_lossy().to_string(),
        title,
        created: false,
        exists: worktree_dir.exists(),
        opened: false,
    })
}

#[tauri::command]
fn monitoring_ingest_lifecycle_event(
    app: AppHandle,
    manager: State<'_, MonitoringManager>,
    req: LifecycleIngestRequest,
) -> Result<LifecycleIngestResponse, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "failed to lock monitoring state".to_string())?;
    let response = state.ingest(req, now_millis());
    let _ = app.emit("monitoring-lifecycle", &response);
    Ok(response)
}

#[tauri::command]
fn monitoring_get_lifecycle_state(
    manager: State<'_, MonitoringManager>,
    req: LifecycleStateQueryRequest,
) -> Result<Option<LifecycleStateResponse>, String> {
    let state = manager
        .state
        .lock()
        .map_err(|_| "failed to lock monitoring state".to_string())?;
    Ok(state.get_state(&req.task_id, &req.member))
}

#[tauri::command]
fn task_register_definition(
    manager: State<'_, MonitoringManager>,
    req: TaskRegistrationRequest,
) -> Result<TaskLifecycleSnapshot, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "failed to lock monitoring state".to_string())?;
    state.register_definition(req)
}

#[tauri::command]
fn task_transition_lifecycle(
    manager: State<'_, MonitoringManager>,
    req: TaskLifecycleTransitionRequest,
) -> Result<TaskLifecycleSnapshot, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "failed to lock monitoring state".to_string())?;
    state.transition_registered(req, now_millis())
}

#[tauri::command]
fn task_get_lifecycle(
    manager: State<'_, MonitoringManager>,
    req: TaskLifecycleLookupRequest,
) -> Result<TaskLifecycleSnapshot, String> {
    let state = manager
        .state
        .lock()
        .map_err(|_| "failed to lock monitoring state".to_string())?;
    state.get_registered_lifecycle(req)
}

#[tauri::command]
fn linear_ingest_webhook_comment(
    monitoring_manager: State<'_, MonitoringManager>,
    pty_manager: State<'_, PtyManager>,
    req: LinearCommentEnvelope,
) -> Result<LinearMessageIngestResponse, String> {
    ingest_linear_comment(&monitoring_manager, &pty_manager, req, "webhook")
}

#[tauri::command]
fn linear_ingest_poll_comments(
    monitoring_manager: State<'_, MonitoringManager>,
    pty_manager: State<'_, PtyManager>,
    req: LinearPollIngestRequest,
) -> Result<Vec<LinearMessageIngestResponse>, String> {
    let mut responses = Vec::with_capacity(req.comments.len());
    for comment in req.comments {
        responses.push(ingest_linear_comment(
            &monitoring_manager,
            &pty_manager,
            comment,
            "polling",
        )?);
    }
    Ok(responses)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let monitoring_manager = MonitoringManager::default();
    tauri::Builder::default()
        .manage(PtyManager::default())
        .manage(WorktreeManager::default())
        .manage(monitoring_manager)
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let manager = app.state::<MonitoringManager>();
            manager.start_runner_if_needed(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            pty_create,
            pty_write,
            pty_resize,
            pty_close,
            worktree_create,
            worktree_open,
            worktree_close,
            worktree_delete,
            worktree_title_info,
            claude_prepare_worktree_hooks,
            monitoring_ingest_lifecycle_event,
            monitoring_get_lifecycle_state,
            task_register_definition,
            task_transition_lifecycle,
            task_get_lifecycle,
            linear_ingest_webhook_comment,
            linear_ingest_poll_comments
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, fs::File, io::Write, process::Command};

    fn request(
        task_id: &str,
        member: &str,
        state: TaskLifecycleState,
        dedupe_key: &str,
    ) -> LifecycleIngestRequest {
        LifecycleIngestRequest {
            task_id: task_id.to_string(),
            member: member.to_string(),
            state,
            message_id: Some(dedupe_key.to_string()),
            dedupe_key: Some(dedupe_key.to_string()),
            source: Some("test".to_string()),
        }
    }

    #[test]
    fn applies_monotonic_transitions() {
        let mut monitoring = MonitoringState::default();
        let task_id = "CON-93";
        let member = "MemberA";

        let sent = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Sent, "event-1"),
            10,
        );
        let ack = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Ack, "event-2"),
            20,
        );
        let in_progress = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::InProgress, "event-3"),
            30,
        );
        let done = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Done, "event-4"),
            40,
        );

        assert_eq!(sent.decision, LifecycleDecision::Applied);
        assert_eq!(ack.decision, LifecycleDecision::Applied);
        assert_eq!(in_progress.decision, LifecycleDecision::Applied);
        assert_eq!(done.decision, LifecycleDecision::Applied);
        assert_eq!(done.current_state, TaskLifecycleState::Done);
        assert_eq!(
            monitoring.get_state(task_id, member),
            Some(LifecycleStateResponse {
                task_id: task_id.to_string(),
                member: member.to_string(),
                state: TaskLifecycleState::Done,
                last_event_id: Some("event-4".to_string()),
                updated_at_ms: 40,
                history_len: 4,
            })
        );
    }

    #[test]
    fn ignores_stale_or_out_of_order_transition() {
        let mut monitoring = MonitoringState::default();
        let task_id = "CON-93";
        let member = "MemberA";

        let _ = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Sent, "event-1"),
            10,
        );
        let _ = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::InProgress, "event-2"),
            20,
        );
        let stale = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Ack, "event-3"),
            30,
        );

        assert_eq!(stale.decision, LifecycleDecision::Stale);
        let record = monitoring
            .get_state(task_id, member)
            .expect("state should exist");
        assert_eq!(record.state, TaskLifecycleState::InProgress);
        assert_eq!(record.updated_at_ms, 20);
        assert_eq!(record.history_len, 3);
    }

    #[test]
    fn handles_duplicate_events_idempotently() {
        let mut monitoring = MonitoringState::default();
        let task_id = "CON-93";
        let member = "MemberA";

        let first = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Sent, "event-1"),
            10,
        );
        let duplicate = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Sent, "event-1"),
            20,
        );

        assert_eq!(first.decision, LifecycleDecision::Applied);
        assert_eq!(duplicate.decision, LifecycleDecision::Duplicate);
        let record = monitoring
            .get_state(task_id, member)
            .expect("state should exist");
        assert_eq!(record.updated_at_ms, 10);
        assert_eq!(record.history_len, 1);
    }

    #[test]
    fn blocks_transition_after_terminal_state() {
        let mut monitoring = MonitoringState::default();
        let task_id = "CON-93";
        let member = "MemberA";

        let _ = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Sent, "event-1"),
            10,
        );
        let _ = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Done, "event-2"),
            20,
        );
        let stale = monitoring.ingest(
            request(task_id, member, TaskLifecycleState::Failed, "event-3"),
            30,
        );

        assert_eq!(stale.decision, LifecycleDecision::Stale);
        let record = monitoring
            .get_state(task_id, member)
            .expect("state should exist");
        assert_eq!(record.state, TaskLifecycleState::Done);
        assert_eq!(record.history_len, 3);
    }

    fn registration_req() -> TaskRegistrationRequest {
        TaskRegistrationRequest {
            task_id: "CON-94".to_string(),
            member: "MemberB".to_string(),
            title: Some("Task definition".to_string()),
            dedupe_key: Some("CON-94:MemberB".to_string()),
        }
    }

    #[test]
    fn registration_starts_without_lifecycle_state() {
        let mut monitoring = MonitoringState::default();
        let snapshot = monitoring.register_definition(registration_req()).unwrap();

        assert_eq!(snapshot.state, None);
        assert_eq!(snapshot.history_len, 0);
        assert_eq!(snapshot.title.as_deref(), Some("Task definition"));
    }

    #[test]
    fn registered_lifecycle_accepts_monotonic_progression() {
        let mut monitoring = MonitoringState::default();
        monitoring.register_definition(registration_req()).unwrap();

        for state in [
            TaskLifecycleState::Sent,
            TaskLifecycleState::Ack,
            TaskLifecycleState::InProgress,
            TaskLifecycleState::Done,
        ] {
            let snapshot = monitoring
                .transition_registered(
                    TaskLifecycleTransitionRequest {
                        task_id: "CON-94".to_string(),
                        member: "MemberB".to_string(),
                        state,
                        message_id: None,
                        dedupe_key: None,
                        source: Some("test".to_string()),
                    },
                    now_millis(),
                )
                .unwrap();
            assert_eq!(snapshot.state, Some(state));
        }
    }

    #[test]
    fn registered_lifecycle_rejects_out_of_order_transition() {
        let mut monitoring = MonitoringState::default();
        monitoring.register_definition(registration_req()).unwrap();

        let err = monitoring
            .transition_registered(
                TaskLifecycleTransitionRequest {
                    task_id: "CON-94".to_string(),
                    member: "MemberB".to_string(),
                    state: TaskLifecycleState::Done,
                    message_id: None,
                    dedupe_key: None,
                    source: Some("test".to_string()),
                },
                now_millis(),
            )
            .unwrap_err();
        assert!(err.contains("invalid lifecycle transition"));
    }

    #[test]
    fn registered_lifecycle_rejects_transition_from_terminal_state() {
        let mut monitoring = MonitoringState::default();
        monitoring.register_definition(registration_req()).unwrap();
        for state in [
            TaskLifecycleState::Sent,
            TaskLifecycleState::Ack,
            TaskLifecycleState::InProgress,
            TaskLifecycleState::Done,
        ] {
            monitoring
                .transition_registered(
                    TaskLifecycleTransitionRequest {
                        task_id: "CON-94".to_string(),
                        member: "MemberB".to_string(),
                        state,
                        message_id: None,
                        dedupe_key: None,
                        source: Some("test".to_string()),
                    },
                    now_millis(),
                )
                .unwrap();
        }

        let err = monitoring
            .transition_registered(
                TaskLifecycleTransitionRequest {
                    task_id: "CON-94".to_string(),
                    member: "MemberB".to_string(),
                    state: TaskLifecycleState::Sent,
                    message_id: None,
                    dedupe_key: None,
                    source: Some("test".to_string()),
                },
                now_millis(),
            )
            .unwrap_err();
        assert!(err.contains("invalid lifecycle transition"));
    }

    #[test]
    fn registered_lifecycle_lookup_fails_for_unknown_task() {
        let monitoring = MonitoringState::default();
        let err = monitoring
            .get_registered_lifecycle(TaskLifecycleLookupRequest {
                task_id: "CON-94".to_string(),
                member: "MemberB".to_string(),
            })
            .unwrap_err();

        assert!(err.contains("task registration not found"));
    }

    #[test]
    fn runner_event_parses_state_from_payload() {
        let path = Path::new("/tmp/logs/codex/CON-90/20260307-000001.jsonl");
        let line = r#"{"type":"posttooluse","member":"MemberA","id":"evt-1"}"#;
        let event = build_runner_event(path, 32, line)
            .expect("parse should succeed")
            .expect("event should be produced");

        assert_eq!(event.request.task_id, "CON-90");
        assert_eq!(event.request.member, "MemberA");
        assert_eq!(event.request.state, TaskLifecycleState::InProgress);
        assert_eq!(event.request.message_id.as_deref(), Some("evt-1"));
    }

    #[test]
    fn runner_event_parses_codex_member_report() {
        let path = Path::new("/tmp/logs/codex/CON-90/20260307-000001.jsonl");
        let line = r#"{"type":"item.completed","item":{"type":"agent_message","text":"@Leader: CON-90 in_review. commit=abc"}} "#;
        let event = build_runner_event(path, 44, line)
            .expect("parse should succeed")
            .expect("event should be produced");

        assert_eq!(event.request.task_id, "CON-90");
        assert_eq!(event.request.state, TaskLifecycleState::InProgress);
        assert_eq!(event.request.source.as_deref(), Some("backend_runner"));
    }

    #[test]
    fn runner_offsets_roundtrip() {
        let root = std::env::temp_dir().join(format!("con90-offsets-{}", now_millis()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("logs/monitoring/runner-offsets.json");
        let mut files = HashMap::new();
        files.insert("/tmp/a.jsonl".to_string(), 123_u64);
        write_runner_offsets(
            &path,
            &MonitoringRunnerOffsets {
                files: files.clone(),
            },
        )
        .unwrap();
        let loaded = read_runner_offsets(&path);
        assert_eq!(loaded.files, files);
    }

    #[test]
    fn runner_collects_codex_jsonl_files() {
        let root = std::env::temp_dir().join(format!("con90-collect-{}", now_millis()));
        let target = root.join("a/logs/codex/CON-90");
        fs::create_dir_all(&target).unwrap();
        let file = target.join("20260307-000001.jsonl");
        let mut handle = File::create(&file).unwrap();
        writeln!(handle, "{{\"type\":\"sent\"}}").unwrap();

        let mut files = Vec::new();
        collect_codex_log_files(&root, &mut files);
        assert!(files.iter().any(|p| p == &file));
    }
    #[test]
    fn monitoring_event_auto_registers_task_definition() {
        let mut monitoring = MonitoringState::default();
        let _ = monitoring.ingest(
            request("CON-91", "MemberB", TaskLifecycleState::Sent, "event-1"),
            10,
        );

        let snapshot = monitoring
            .get_registered_lifecycle(TaskLifecycleLookupRequest {
                task_id: "CON-91".to_string(),
                member: "MemberB".to_string(),
            })
            .expect("task should be auto-registered");

        assert_eq!(snapshot.task_id, "CON-91");
        assert_eq!(snapshot.member, "MemberB");
        assert_eq!(snapshot.state, Some(TaskLifecycleState::Sent));
        assert_eq!(snapshot.history_len, 1);
        assert_eq!(snapshot.title, None);
        assert_eq!(snapshot.dedupe_key, None);
    }

    #[test]
    fn runner_event_parses_claude_hook_states() {
        let path = Path::new("/tmp/logs/codex/CON-76/20260307-000001.jsonl");
        let cases = [
            (
                r#"{"task_id":"CON-76","member":"MemberA","hook_event_name":"Stop","id":"evt-human"}"#,
                TaskLifecycleState::Ack,
            ),
            (
                r#"{"task_id":"CON-76","member":"MemberA","hook_event_name":"PreToolUse","id":"evt-tool"}"#,
                TaskLifecycleState::InProgress,
            ),
            (
                r#"{"task_id":"CON-76","member":"MemberA","hook_event_name":"TaskCompleted","id":"evt-done"}"#,
                TaskLifecycleState::Done,
            ),
            (
                r#"{"task_id":"CON-76","member":"MemberA","hook_event_name":"PostToolUseFailure","id":"evt-fail"}"#,
                TaskLifecycleState::Failed,
            ),
        ];

        for (line, expected) in cases {
            let event = build_runner_event(path, 18, line)
                .expect("parse should succeed")
                .expect("event should be produced");
            assert_eq!(event.request.task_id, "CON-76");
            assert_eq!(event.request.member, "MemberA");
            assert_eq!(event.request.state, expected);
        }
    }

    fn run_cmd(cwd: &Path, cmd: &str, args: &[&str]) {
        let output = Command::new(cmd)
            .current_dir(cwd)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{} {:?} failed: {}",
            cmd,
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_temp_repo(prefix: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("{prefix}-{}", now_millis()));
        fs::create_dir_all(&root).unwrap();
        run_cmd(&root, "git", &["init"]);
        run_cmd(&root, "git", &["config", "user.email", "test@example.com"]);
        run_cmd(&root, "git", &["config", "user.name", "tester"]);
        fs::write(root.join("README.md"), "seed\n").unwrap();
        run_cmd(&root, "git", &["add", "README.md"]);
        run_cmd(&root, "git", &["commit", "-m", "init"]);
        root
    }

    #[test]
    fn worktree_slug_replaces_separators() {
        assert_eq!(worktree_slug("feature/demo"), "feature-demo");
        assert_eq!(worktree_slug("feature\\demo"), "feature-demo");
    }

    #[test]
    fn worktree_create_and_remove_support_hooks_and_copyignored() {
        let repo_root = init_temp_repo("con69-worktree");
        fs::write(repo_root.join(".gitignore"), ".env\n").unwrap();
        fs::write(repo_root.join(".env"), "TOKEN=abc\n").unwrap();
        let basedir = repo_root.join(".wt");
        fs::create_dir_all(&basedir).unwrap();

        let branch = "feature/con-69-test";
        let hook = "printf created > .hook-created";
        let (worktree_dir, created) = ensure_worktree_created(
            &repo_root,
            branch,
            basedir.to_str().unwrap(),
            true,
            Some(hook),
        )
        .unwrap();
        assert!(created);
        assert!(worktree_dir.exists());
        assert_eq!(
            fs::read_to_string(worktree_dir.join(".env")).unwrap(),
            "TOKEN=abc\n"
        );
        assert!(worktree_dir.join(".hook-created").exists());

        let removed = remove_worktree(
            &repo_root,
            &worktree_dir,
            Some("printf deleted > ../.deletehook-ran"),
            true,
        )
        .unwrap();
        assert!(removed);
        assert!(repo_root.join(".wt/.deletehook-ran").exists());
        assert!(!worktree_dir.exists());
    }

    #[test]
    fn worktree_hooks_write_project_local_settings_only() {
        let root = std::env::temp_dir().join(format!("con76-worktree-{}", now_millis()));
        let worktree = root.join(".wt/con-76");
        fs::create_dir_all(&worktree).unwrap();

        let response = ensure_claude_worktree_hooks(&worktree, "CON-76", "MemberA", &root).unwrap();
        let settings_path = worktree.join(".claude/settings.json");
        let script_path = worktree.join(".claude/hooks/cockpit-monitor.sh");

        assert_eq!(response.settings_path, settings_path.to_string_lossy());
        assert_eq!(response.hook_script_path, script_path.to_string_lossy());
        assert!(settings_path.exists());
        assert!(script_path.exists());
        assert_eq!(
            response.log_file_path,
            root.join("logs/codex/CON-76/claude-hooks.jsonl")
                .to_string_lossy()
        );
        assert!(!root.join(".claude/settings.json").exists());
    }

    #[test]
    fn worktree_hooks_preserve_existing_non_cockpit_hooks() {
        let root = std::env::temp_dir().join(format!("con76-settings-{}", now_millis()));
        let worktree = root.join(".wt/con-76-existing");
        fs::create_dir_all(worktree.join(".claude")).unwrap();
        let settings_path = worktree.join(".claude/settings.json");
        fs::write(
            &settings_path,
            r#"{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo keep-me"
          }
        ]
      }
    ]
  }
}"#,
        )
        .unwrap();

        ensure_claude_worktree_hooks(&worktree, "CON-76", "MemberA", &root).unwrap();
        let parsed: serde_json::Value =
            serde_json::from_slice(&fs::read(&settings_path).unwrap()).unwrap();

        let stop_hooks = parsed
            .get("hooks")
            .and_then(|v| v.get("Stop"))
            .and_then(|v| v.as_array())
            .unwrap();
        assert!(
            stop_hooks.iter().any(|entry| {
                entry
                    .get("hooks")
                    .and_then(|v| v.as_array())
                    .map(|hooks| {
                        hooks.iter().any(|hook| {
                            hook.get("command").and_then(|v| v.as_str()) == Some("echo keep-me")
                        })
                    })
                    .unwrap_or(false)
            }),
            "existing non-cockpit hook must be preserved"
        );
        assert!(
            stop_hooks.iter().any(is_cockpit_hook_entry),
            "cockpit hook must be present"
        );
    }

    #[test]
    fn linear_normalization_uses_target_member_or_mention() {
        let explicit = normalize_linear_comment(
            LinearCommentEnvelope {
                issue_id: "CON-75".to_string(),
                comment_id: Some("cmt-1".to_string()),
                body: "@MemberB: please check logs".to_string(),
                target_member: Some("MemberB".to_string()),
                source: None,
            },
            "webhook",
        )
        .expect("explicit target should normalize");
        assert_eq!(explicit.issue_id, "CON-75");
        assert_eq!(explicit.target_member, "MemberB");
        assert_eq!(explicit.body, "please check logs");
        assert_eq!(explicit.source, "webhook");
        assert_eq!(explicit.event_key, "linear:CON-75:cmt-1");

        let by_mention = normalize_linear_comment(
            LinearCommentEnvelope {
                issue_id: "CON-75".to_string(),
                comment_id: None,
                body: "@MemberA run validation".to_string(),
                target_member: None,
                source: Some("polling".to_string()),
            },
            "webhook",
        )
        .expect("mention target should normalize");
        assert_eq!(by_mention.target_member, "MemberA");
        assert_eq!(by_mention.source, "polling");
        assert_eq!(by_mention.body, "run validation");
    }

    #[test]
    fn linear_ingest_is_deduped_and_marks_unroutable_without_route() {
        let monitoring = MonitoringManager::default();
        let pty = PtyManager::default();
        let comment = LinearCommentEnvelope {
            issue_id: "CON-75".to_string(),
            comment_id: Some("cmt-2".to_string()),
            body: "@MemberB status?".to_string(),
            target_member: None,
            source: None,
        };

        let first = ingest_linear_comment(&monitoring, &pty, comment.clone(), "webhook").unwrap();
        let second = ingest_linear_comment(&monitoring, &pty, comment, "polling").unwrap();
        assert_eq!(first.decision, LinearMessageDecision::Unroutable);
        assert_eq!(second.decision, LinearMessageDecision::Duplicate);
        assert_eq!(first.event_key, second.event_key);
    }

    #[test]
    fn linear_normalization_rejects_empty_normalized_body() {
        let err = normalize_linear_comment(
            LinearCommentEnvelope {
                issue_id: "CON-75".to_string(),
                comment_id: None,
                body: "@MemberA".to_string(),
                target_member: Some("MemberA".to_string()),
                source: None,
            },
            "webhook",
        )
        .unwrap_err();

        assert_eq!(err, LinearCommentParseError::EmptyNormalizedBody);
    }

    #[test]
    fn linear_normalization_rejects_missing_member() {
        let err = normalize_linear_comment(
            LinearCommentEnvelope {
                issue_id: "CON-75".to_string(),
                comment_id: None,
                body: "please check this".to_string(),
                target_member: None,
                source: None,
            },
            "webhook",
        )
        .unwrap_err();

        assert_eq!(err, LinearCommentParseError::MissingTargetMember);
    }

    #[test]
    fn runner_event_returns_error_on_invalid_json() {
        let path = Path::new("/tmp/logs/codex/CON-90/20260307-000001.jsonl");
        let err = build_runner_event(path, 91, "{invalid").unwrap_err();

        assert!(err.contains("invalid runner event json"));
    }

    #[test]
    fn runner_event_ignores_non_lifecycle_payload() {
        let path = Path::new("/tmp/logs/codex/CON-90/20260307-000001.jsonl");
        let line = r#"{"type":"trace.span","id":"evt-1"}"#;
        let event = build_runner_event(path, 32, line).expect("parse should succeed");

        assert!(event.is_none());
    }
}
