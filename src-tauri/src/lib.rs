use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread::JoinHandle,
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
    let writer = pair.master.take_writer().map_err(|e| format!("writer failed: {e}"))?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyManager::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty_create,
            pty_write,
            pty_resize,
            pty_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
