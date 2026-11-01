use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime, WebviewWindow};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<ShareKit<R>> {
    Ok(ShareKit(app.clone()))
}

/// Access to the share APIs.
pub struct ShareKit<R: Runtime>(AppHandle<R>);

impl<R: Runtime> ShareKit<R> {
    pub fn native(&self, _method: &str, _args: serde_json::Value) -> crate::Result<serde_json::Value> {
        Ok(serde_json::Value::Null)
    }

    pub fn share_text(
        &self,
        _window: WebviewWindow<R>,
        _text: String,
        _options: ShareTextOptions,
    ) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatform)
    }

    pub fn share_file(
        &self,
        _window: WebviewWindow<R>,
        _url: String,
        _options: ShareFileOptions,
    ) -> crate::Result<()> {
        Err(crate::Error::UnsupportedPlatform)
    }
}
