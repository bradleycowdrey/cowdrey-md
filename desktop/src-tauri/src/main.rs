#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Files macOS asked us to open (Finder double-click, "Open With", drag onto the Dock icon)
/// that the page has not picked up yet.
struct PendingFiles(Mutex<Vec<String>>);

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![take_opened_files, read_text_file, write_text_file])
        .build(tauri::generate_context!())
        .expect("Cowdrey.md could not start")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
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
