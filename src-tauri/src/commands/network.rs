use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::state::{AppInner, AppState};
use crate::vm::{self, VmError, VmState, VmSummary};

#[tauri::command]
pub async fn set_vm_network_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<VmSummary, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| {
            ensure_network_editable(inner, &id)?;

            let previous = {
                let config = inner
                    .store
                    .vm_mut(&id)
                    .ok_or_else(|| VmError::NotFound(id.clone()))?;
                let previous = (config.network.clone(), config.updated_at_unix);
                config.network.enabled = enabled;
                config.updated_at_unix = vm::unix_now();
                previous
            };

            if let Err(error) = inner.store.save() {
                if let Some(config) = inner.store.vm_mut(&id) {
                    config.network = previous.0;
                    config.updated_at_unix = previous.1;
                }
                return Err(error.into());
            }

            summary(inner, &id)
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("network settings task failed: {error}")))?
}

fn ensure_network_editable(inner: &AppInner, id: &str) -> Result<(), AppError> {
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
            message: "stop the machine before changing networking".to_string(),
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
