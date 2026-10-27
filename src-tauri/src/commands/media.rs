use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;
use crate::state::{AppInner, AppState};
use crate::vm::{self, media, BootMode, VmError, VmState, VmSummary};

#[tauri::command]
pub async fn pick_iso_file(app: AppHandle) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_title("Select an installation ISO")
            .add_filter("ISO images", &["iso"])
            .blocking_pick_file();

        match selected {
            None => Ok(None),
            Some(file) => file
                .into_path()
                .map_err(|error| {
                    AppError::Task(format!("the selected ISO path could not be read: {error}"))
                })
                .and_then(|path| {
                    path.into_os_string().into_string().map(Some).map_err(|_| {
                        AppError::Vm(VmError::Unsupported(
                            "the selected ISO path must be valid UTF-8".to_string(),
                        ))
                    })
                }),
        }
    })
    .await
    .map_err(|error| AppError::Task(format!("the file picker task failed: {error}")))?
}

#[tauri::command]
pub async fn set_vm_install_iso(
    app: AppHandle,
    id: String,
    path: Option<String>,
) -> Result<VmSummary, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| {
            ensure_media_editable(inner, &id)?;

            let (stored, boot_mode) = match path {
                Some(value) => (Some(media::validate_iso_file(&value)?), BootMode::Installer),
                None => (None, BootMode::Disk),
            };

            let previous = {
                let config = inner
                    .store
                    .vm_mut(&id)
                    .ok_or_else(|| VmError::NotFound(id.clone()))?;
                let previous = (
                    config.install_iso_path.clone(),
                    config.boot_mode,
                    config.updated_at_unix,
                );
                config.install_iso_path = stored;
                config.boot_mode = boot_mode;
                config.updated_at_unix = vm::unix_now();
                previous
            };

            if let Err(error) = inner.store.save() {
                if let Some(config) = inner.store.vm_mut(&id) {
                    config.install_iso_path = previous.0;
                    config.boot_mode = previous.1;
                    config.updated_at_unix = previous.2;
                }
                return Err(error.into());
            }

            summary(inner, &id)
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("installation media task failed: {error}")))?
}

#[tauri::command]
pub async fn set_vm_boot_mode(
    app: AppHandle,
    id: String,
    boot_mode: BootMode,
) -> Result<VmSummary, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| {
            ensure_media_editable(inner, &id)?;

            if boot_mode == BootMode::Installer {
                let raw = inner
                    .store
                    .vm(&id)
                    .and_then(|config| config.install_iso_path.as_deref())
                    .ok_or_else(|| {
                        VmError::Validation(
                            "attach an installation ISO before selecting installer boot"
                                .to_string(),
                        )
                    })?;

                media::validate_iso_file(raw)?;
            }

            let previous = {
                let config = inner
                    .store
                    .vm_mut(&id)
                    .ok_or_else(|| VmError::NotFound(id.clone()))?;
                let previous = (config.boot_mode, config.updated_at_unix);
                config.boot_mode = boot_mode;
                config.updated_at_unix = vm::unix_now();
                previous
            };

            if let Err(error) = inner.store.save() {
                if let Some(config) = inner.store.vm_mut(&id) {
                    config.boot_mode = previous.0;
                    config.updated_at_unix = previous.1;
                }
                return Err(error.into());
            }

            summary(inner, &id)
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("boot mode task failed: {error}")))?
}

fn ensure_media_editable(inner: &AppInner, id: &str) -> Result<(), AppError> {
    let config = inner
        .store
        .vm(id)
        .ok_or_else(|| VmError::NotFound(id.to_string()))?;

    if inner.runtime.contains_key(id)
        || matches!(
            config.state,
            VmState::Starting | VmState::Running | VmState::Stopping
        )
    {
        return Err(VmError::Busy {
            id: id.to_string(),
            message: "stop the machine before changing installation media or boot mode".to_string(),
        }
        .into());
    }

    Ok(())
}

fn summary(inner: &AppInner, id: &str) -> Result<VmSummary, AppError> {
    let config = inner
        .store
        .vm(id)
        .ok_or_else(|| VmError::NotFound(id.to_string()))?;

    Ok(VmSummary::from_config(config, config.state, None))
}
