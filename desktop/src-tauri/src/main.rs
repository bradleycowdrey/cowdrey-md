#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

/// Files macOS asked us to open (Finder double-click, "Open With", drag onto the Dock icon)
/// that the page has not picked up yet.
struct PendingFiles(Mutex<Vec<String>>);

/// Set once the page has saved and we are allowed to quit.
struct Quitting(AtomicBool);

#[derive(serde::Serialize, Clone)]
struct OpenedFile {
    name: String,
    path: String,
    content: String,
}

fn load(path: &Path) -> Option<OpenedFile> {
    let content = std::fs::read_to_string(path).ok()?;
    Some(OpenedFile {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
fn take_opened_files(state: tauri::State<PendingFiles>) -> Vec<OpenedFile> {
    let paths = std::mem::take(&mut *state.0.lock().unwrap());
    paths.iter().filter_map(|p| load(Path::new(p))).collect()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<OpenedFile, String> {
    load(Path::new(&path)).ok_or_else(|| format!("Could not read {path}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Called just before an update relaunches the app, so the quit handler lets it go.
#[tauri::command]
fn allow_exit(app: AppHandle) {
    app.state::<Quitting>().0.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.state::<Quitting>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// Ask the page to save, then quit. If the page does not answer quickly, quit anyway.
fn flush_then_quit(app: &AppHandle) {
    let _ = app.emit("flush-and-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        handle.state::<Quitting>().0.store(true, Ordering::SeqCst);
        handle.exit(0);
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .manage(Quitting(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![take_opened_files, read_text_file, write_text_file, quit_app, allow_exit])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if !app.state::<Quitting>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    flush_then_quit(app);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Cowdrey.MD could not start")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, code, .. } = &event {
                if code.is_none() && !app.state::<Quitting>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    flush_then_quit(app);
                }
            }
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    app.state::<PendingFiles>().0.lock().unwrap().extend(paths);
                    let _ = app.emit("open-files", ());
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_focus();
                    }
                }
            }
            let _ = (app, event);
        });
}
