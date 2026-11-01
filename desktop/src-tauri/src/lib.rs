use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
#[cfg(desktop)]
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(desktop)]
use tauri::Wry;
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

/// A file path is read here. Android hands over a content:// address instead: that comes back with no
/// content, and the page reads it through the file system plugin, which can open such addresses.
fn opened(p: &str) -> Option<OpenedFile> {
    if p.contains("://") {
        return Some(OpenedFile { name: String::new(), path: p.to_string(), content: String::new() });
    }
    load(Path::new(p))
}

#[tauri::command]
fn take_opened_files(state: tauri::State<PendingFiles>) -> Vec<OpenedFile> {
    let paths = std::mem::take(&mut *state.0.lock().unwrap());
    paths.iter().filter_map(|p| opened(p)).collect()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<OpenedFile, String> {
    load(Path::new(&path)).ok_or_else(|| format!("Could not read {path}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Writes bytes sent as base64 (Word documents and other binary exports).
#[tauri::command]
fn write_binary_file(path: String, base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(serde::Serialize)]
struct FolderFile {
    path: String,
    modified: u64,
}

#[derive(serde::Serialize)]
struct FolderListing {
    name: String,
    files: Vec<FolderFile>,
    folders: Vec<String>,
}

/// The Markdown files in a sync folder and its subfolders, with paths relative to it.
#[cfg(desktop)]
#[tauri::command]
fn list_folder(dir: String) -> Result<FolderListing, String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Err(format!("{dir} is not a folder that can be opened"));
    }
    let mut files = Vec::new();
    let mut folders = Vec::new();
    fn walk(root: &Path, dir: &Path, depth: u32, files: &mut Vec<FolderFile>, folders: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            if path.is_dir() {
                folders.push(rel);
                if depth < 8 {
                    walk(root, &path, depth + 1, files, folders);
                }
            } else {
                let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if ["md", "markdown", "mdown", "mkd", "mkdn", "txt"].contains(&ext.as_str()) {
                    files.push(FolderFile { modified: modified_ms(&path), path: rel });
                }
            }
        }
    }
    walk(root, root, 0, &mut files, &mut folders);
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir.clone());
    Ok(FolderListing { name, files, folders })
}

/// Writes a file in a sync folder, creating its folders, and returns its new modification time.
#[cfg(desktop)]
#[tauri::command]
fn write_in_folder(path: String, contents: String) -> Result<u64, String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(p, contents).map_err(|e| e.to_string())?;
    Ok(modified_ms(p))
}

/// Deletes a file from a sync folder (it is already gone if it isn't there).
#[cfg(desktop)]
#[tauri::command]
fn remove_file(path: String) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Opens the system print dialog for the page (its PDF button saves a PDF).
#[cfg(desktop)]
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Writes a copy to share into the app's temporary folder and returns its path, for the share sheet.
#[cfg(mobile)]
#[tauri::command]
fn write_share_file(name: String, contents: String, base64: Option<String>) -> Result<String, String> {
    use base64::Engine;
    let name: String = name.chars().map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c }).collect();
    let path = std::env::temp_dir().join(if name.trim().is_empty() { "Untitled.md".into() } else { name });
    match base64 {
        Some(b) => std::fs::write(&path, base64::engine::general_purpose::STANDARD.decode(b).map_err(|e| e.to_string())?),
        None => std::fs::write(&path, contents),
    }
    .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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
#[cfg(desktop)]
#[derive(serde::Deserialize)]
struct MenuSpec {
    title: String,
    items: Vec<ItemSpec>,
}

#[cfg(desktop)]
#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ItemSpec {
    Item { id: String, label: String, accel: Option<String>, checked: Option<bool> },
    Sep,
    Native { role: String },
}

#[cfg(desktop)]
type Item = Box<dyn IsMenuItem<Wry>>;

#[cfg(desktop)]
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

#[cfg(desktop)]
fn submenu(app: &AppHandle, title: &str, items: &[Item]) -> tauri::Result<Submenu<Wry>> {
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Submenu::with_items(app, title, true, &refs)
}

/// Replace the menu bar: the Cowdrey.MD app menu, the page's own menus, then Window.
#[cfg(desktop)]
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

#[cfg(desktop)]
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

/// The Mac app and the iPhone and iPad app share this entry point. On iOS the page runs as it does
/// on the web, so the menu bar, in-place updates and file paths are Mac-only.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![take_opened_files, read_text_file, write_text_file, write_binary_file, list_folder, write_in_folder, remove_file, print_page, quit_app, allow_exit, set_menu, hold_quit])
        .on_menu_event(|app, event| {
            if event.id().0 == "app:quit" || event.id().0 == "app:closeWindow" {
                flush_then_quit(app);
                return;
            }
            if let Some(cmd) = event.id().0.strip_prefix("cmd:") {
                let _ = app.emit("menu-command", cmd.to_string());
            }
        });
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fs::init());
    #[cfg(mobile)]
    let builder = builder
        .plugin(tauri_plugin_sharekit::init())
        .invoke_handler(tauri::generate_handler![take_opened_files, read_text_file, write_text_file, write_binary_file, write_share_file, quit_app, allow_exit, hold_quit]);
    // Automated checks in the iPhone Simulator (see .github/workflows/ios-qa.yml): with COWDREY_QA set, the page
    // opens that panel a few seconds after launch, so the check can photograph it. Nothing happens otherwise.
    #[cfg(mobile)]
    let builder = builder.setup(|app| {
        if let Ok(kind) = std::env::var("COWDREY_QA") {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                let kind: String = kind.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.eval(&format!("window.__cowdreyQA && window.__cowdreyQA('{kind}')"));
                }
            });
        }
        Ok(())
    });
    builder
        .manage(PendingFiles(Mutex::new(Vec::new())))
        .manage(Quitting(AtomicBool::new(false)))
        .manage(QuitHeld(AtomicBool::new(false)))
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
            // Finder "Open With" on the Mac, "Open in Cowdrey.MD" from Files or Mail on iPhone and iPad, and
            // "Open with" from a file manager, Drive or Gmail on Android (a content:// address).
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let RunEvent::Opened { urls } = &event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| match u.to_file_path() {
                        Ok(p) => Some(p.to_string_lossy().into_owned()),
                        Err(_) if u.scheme() == "content" => Some(u.to_string()),
                        Err(_) => None,
                    })
                    .collect();
                if !paths.is_empty() {
                    app.state::<PendingFiles>().0.lock().unwrap().extend(paths);
                    let _ = app.emit("open-files", ());
                    #[cfg(desktop)]
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_focus();
                    }
                }
            }
            let _ = (app, event);
        });
}
