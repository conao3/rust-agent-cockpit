use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
#[cfg(not(test))]
use std::fs::{create_dir_all, OpenOptions};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Default)]
struct PtyManager {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, PtySession>>,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Option<JoinHandle<()>>,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyCreateResponse {
    id: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutputEvent {
    id: String,
    data: String,
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

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn lifecycle_key(task_id: &str, member: &str) -> String {
    format!("{}::{}", task_id.trim(), member.trim())
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

fn monitoring_member_fallback() -> String {
    std::env::var("COCKPIT_MONITORING_MEMBER").unwrap_or_else(|_| "MemberA".to_string())
}

fn normalize_lifecycle_state(value: &str) -> Option<TaskLifecycleState> {
    match value.trim().to_ascii_lowercase().as_str() {
        "sent" | "queued" => Some(TaskLifecycleState::Sent),
        "ack" | "acknowledged" | "stop" | "waiting" => Some(TaskLifecycleState::Ack),
        "in_progress" | "in-progress" | "running" | "executing" | "pretooluse" | "posttooluse" => {
            Some(TaskLifecycleState::InProgress)
        }
        "done" | "completed" | "complete" | "finished" | "success" | "succeeded" => {
            Some(TaskLifecycleState::Done)
        }
        "failed" | "error" => Some(TaskLifecycleState::Failed),
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
    let payload: serde_json::Value = serde_json::from_str(line).map_err(|e| format!("{e}"))?;
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
        None => return Ok(None),
    };
    let task_id = match extract_task_id(path, &payload) {
        Some(task_id) => task_id,
        None => return Ok(None),
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

#[tauri::command]
fn pty_create(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    req: PtyCreateRequest,
) -> Result<PtyCreateResponse, String> {
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
    };

    let mut sessions = manager
        .sessions
        .lock()
        .map_err(|_| "failed to lock sessions".to_string())?;
    sessions.insert(id.clone(), session);

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
    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let monitoring_manager = MonitoringManager::default();
    tauri::Builder::default()
        .manage(PtyManager::default())
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
            monitoring_ingest_lifecycle_event,
            monitoring_get_lifecycle_state,
            task_register_definition,
            task_transition_lifecycle,
            task_get_lifecycle
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, fs::File, io::Write};

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
}
