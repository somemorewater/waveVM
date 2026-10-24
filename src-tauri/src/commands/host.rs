use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::host::{self, HostInfo};

#[tauri::command]
pub async fn detect_host(app: AppHandle) -> Result<HostInfo, AppError> {
    let app_data_dir = app.path().app_data_dir().ok();
    let resource_dir = app.path().resource_dir().ok();

    tauri::async_runtime::spawn_blocking(move || {
        host::detect(app_data_dir.as_deref(), resource_dir.as_deref())
    })
    .await
    .map_err(|error| AppError::Task(format!("host diagnostics task failed: {error}")))
}
