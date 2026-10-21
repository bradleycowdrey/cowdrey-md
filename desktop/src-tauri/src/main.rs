#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent, Wry};

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

/// Set while the page asks about unsaved files, so the quit below waits for the answer.
struct QuitHeld(AtomicBool);

#[tauri::command]
fn hold_quit(app: AppHandle, hold: bool) {
    app.state::<QuitHeld>().0.store(hold, Ordering::SeqCst);
}

/// Ask the page to save, then quit. If the page does not answer quickly, quit anyway,
/// unless it is asking the person what to do with unsaved files.
fn flush_then_quit(app: &AppHandle) {
    let _ = app.emit("flush-and-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        if handle.state::<QuitHeld>().0.load(Ordering::SeqCst) {
            return;
        }
        handle.state::<Quitting>().0.store(true, Ordering::SeqCst);
        handle.exit(0);
    });
}

/// One menu in the menu bar, described by the page so it matches the in-app menus exactly.
#[derive(serde::Deserialize)]
struct MenuSpec {
    title: String,
    items: Vec<ItemSpec>,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ItemSpec {
    Item { id: String, label: String, accel: Option<String>, checked: Option<bool> },
    Sep,
    Native { role: String },
}

type Item = Box<dyn IsMenuItem<Wry>>;

fn build_items(app: &AppHandle, specs: &[ItemSpec]) -> tauri::Result<Vec<Item>> {
    let mut out: Vec<Item> = Vec::new();
    for spec in specs {
        match spec {
            ItemSpec::Sep => out.push(Box::new(PredefinedMenuItem::separator(app)?)),
            ItemSpec::Native { role } => match role.as_str() {
                "cut" => out.push(Box::new(PredefinedMenuItem::cut(app, None)?)),
                "copy" => out.push(Box::new(PredefinedMenuItem::copy(app, None)?)),
                "paste" => out.push(Box::new(PredefinedMenuItem::paste(app, None)?)),
                "undo" => out.push(Box::new(PredefinedMenuItem::undo(app, None)?)),
                "redo" => out.push(Box::new(PredefinedMenuItem::redo(app, None)?)),
                "select_all" => out.push(Box::new(PredefinedMenuItem::select_all(app, None)?)),
                _ => {}
            },
            ItemSpec::Item { id, label, accel, checked } => match checked {
                Some(on) => out.push(Box::new(CheckMenuItem::with_id(app, id, label, true, *on, accel.as_deref())?)),
                None => out.push(Box::new(MenuItem::with_id(app, id, label, true, accel.as_deref())?)),
            },
        }
    }
    Ok(out)
}

fn submenu(app: &AppHandle, title: &str, items: &[Item]) -> tauri::Result<Submenu<Wry>> {
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Submenu::with_items(app, title, true, &refs)
}

/// Replace the menu bar: the Cowdrey.MD app menu, the page's own menus, then Window.
#[tauri::command]
fn set_menu(app: AppHandle, menus: Vec<MenuSpec>) -> Result<(), String> {
    let build = || -> tauri::Result<Menu<Wry>> {
        let app_items: Vec<Item> = vec![
            Box::new(MenuItem::with_id(&app, "cmd:about", "About Cowdrey.MD", true, None::<&str>)?),
            Box::new(MenuItem::with_id(&app, "cmd:checkUpdates", "Check for Updates…", true, None::<&str>)?),
            Box::new(PredefinedMenuItem::separator(&app)?),
            Box::new(PredefinedMenuItem::services(&app, None)?),
            Box::new(PredefinedMenuItem::separator(&app)?),
            Box::new(PredefinedMenuItem::hide(&app, None)?),
            Box::new(PredefinedMenuItem::hide_others(&app, None)?),
            Box::new(PredefinedMenuItem::show_all(&app, None)?),
            Box::new(PredefinedMenuItem::separator(&app)?),
            // a custom Quit so the page can save before the app exits (the predefined one skips that)
            Box::new(MenuItem::with_id(&app, "app:quit", "Quit Cowdrey.MD", true, Some("CmdOrCtrl+Q"))?),
        ];
        let mut subs: Vec<Submenu<Wry>> = vec![submenu(&app, "Cowdrey.MD", &app_items)?];
        let mut window_added = false;
        for m in &menus {
            if m.title == "Help" && !window_added {
                subs.push(window_menu(&app)?);
                window_added = true;
            }
            let items = build_items(&app, &m.items)?;
            subs.push(submenu(&app, &m.title, &items)?);
        }
        if !window_added {
            subs.push(window_menu(&app)?);
        }
        let refs: Vec<&dyn IsMenuItem<Wry>> = subs.iter().map(|s| s as &dyn IsMenuItem<Wry>).collect();
        Menu::with_items(&app, &refs)
    };
    let menu = build().map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

fn window_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let items: Vec<Item> = vec![
        Box::new(PredefinedMenuItem::minimize(app, None)?),
        Box::new(PredefinedMenuItem::maximize(app, None)?),
        Box::new(PredefinedMenuItem::fullscreen(app, None)?),
        Box::new(PredefinedMenuItem::separator(app)?),
        // Cmd+W closes the current tab (File menu), as in most tabbed apps.
        Box::new(MenuItem::with_id(app, "app:closeWindow", "Close Window", true, Some("CmdOrCtrl+Shift+W"))?),
    ];
    submenu(app, "Window", &items)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .manage(Quitting(AtomicBool::new(false)))
        .manage(QuitHeld(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![take_opened_files, read_text_file, write_text_file, quit_app, allow_exit, set_menu, hold_quit])
        .on_menu_event(|app, event| {
            if event.id().0 == "app:quit" || event.id().0 == "app:closeWindow" {
                flush_then_quit(app);
                return;
            }
            if let Some(cmd) = event.id().0.strip_prefix("cmd:") {
                let _ = app.emit("menu-command", cmd.to_string());
            }
        })
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
