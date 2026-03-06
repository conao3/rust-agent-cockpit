use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
#[cfg(not(test))]
use std::{fs::{create_dir_all, OpenOptions}, path::Path};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread::JoinHandle,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

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

#[derive(Default)]
struct MonitoringManager {
    state: Mutex<MonitoringState>,
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

#[derive(Debug, Deserialize)]
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

fn is_valid_registered_transition(from: Option<TaskLifecycleState>, to: TaskLifecycleState) -> bool {
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
                TaskLifecycleState::Ack | TaskLifecycleState::InProgress | TaskLifecycleState::Failed
            )
        }
        Some(TaskLifecycleState::InProgress) => {
            matches!(
                to,
                TaskLifecycleState::InProgress | TaskLifecycleState::Done | TaskLifecycleState::Failed
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

        let dedupe_key = req
            .dedupe_key
            .clone()
            .or_else(|| {
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
    manager: State<'_, MonitoringManager>,
    req: LifecycleIngestRequest,
) -> Result<LifecycleIngestResponse, String> {
    let mut state = manager
        .state
        .lock()
        .map_err(|_| "failed to lock monitoring state".to_string())?;
    Ok(state.ingest(req, now_millis()))
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
    tauri::Builder::default()
        .manage(PtyManager::default())
        .manage(MonitoringManager::default())
        .plugin(tauri_plugin_opener::init())
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
}
