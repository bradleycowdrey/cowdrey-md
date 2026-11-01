use tauri::AppHandle;
use tauri::{command, Runtime, WebviewWindow};

use crate::models::*;
use crate::ShareExt;

#[command]
pub async fn share_text<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    text: String,
    mime_type: Option<String>,
    position: Option<SharePosition>,
) -> Result<(), String> {
    app_handle
        .share()
        .share_text(
            window,
            text,
            ShareTextOptions {
                mime_type,
                position,
            },
        )
        .map_err(|e| e.to_string())
}

#[command]
pub async fn share_file<R: Runtime>(
    app_handle: AppHandle<R>,
    window: WebviewWindow<R>,
    url: String,
    mime_type: Option<String>,
    title: Option<String>,
    position: Option<SharePosition>,
) -> Result<(), String> {
    app_handle
        .share()
        .share_file(
            window,
            url,
            ShareFileOptions {
                mime_type,
                title,
                position,
            },
        )
        .map_err(|e| e.to_string())
}

/// Cowdrey.MD's own native features on iPhone, iPad and Android (printing, PDF, files and folders),
/// each a method of the platform plugin. Only the methods listed here can be called.
const NATIVE_METHODS: &[&str] = &[
    "printPage", "exportPdf",
    "pickFiles", "saveAsFile", "readFile", "writeFile",
    "pickFolder", "listFolder", "readInFolder", "writeInFolder", "deleteInFolder",
];

#[command]
pub async fn native<R: Runtime>(
    app_handle: AppHandle<R>,
    method: String,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !NATIVE_METHODS.contains(&method.as_str()) {
        return Err(format!("Unknown method {method}"));
    }
    app_handle
        .share()
        .native(&method, args.unwrap_or(serde_json::Value::Object(Default::default())))
        .map_err(|e| e.to_string())
}
