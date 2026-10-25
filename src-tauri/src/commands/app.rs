use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub data_dir: String,
    pub config_path: String,
    pub vms_dir: String,
    pub schema_version: u32,
    pub created_at_unix: u64,
    pub last_opened_unix: u64,
}

#[tauri::command]
pub async fn get_app_info(app: AppHandle) -> Result<AppInfo, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| {
            let store = &inner.store;
            let config = store.config();

            Ok(AppInfo {
                name: "Wave VM",
                version: env!("CARGO_PKG_VERSION"),
                data_dir: store.data_dir().display().to_string(),
                config_path: store.config_path().display().to_string(),
                vms_dir: store.vms_dir().display().to_string(),
                schema_version: config.schema_version,
                created_at_unix: config.created_at_unix,
                last_opened_unix: config.last_opened_unix,
            })
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("application information task failed: {error}")))?
}
