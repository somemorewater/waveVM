use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::config::{ConfigError, ConfigStore};
use crate::error::AppError;
use crate::vm::runtime::RunningVm;
use crate::vm::{runtime as vm_runtime, unix_now, VmState};

pub struct AppInner {
    pub store: ConfigStore,
    pub runtime: HashMap<String, RunningVm>,
}

pub struct AppState {
    inner: Result<Mutex<AppInner>, ConfigError>,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Self {
        let inner = app
            .path()
            .app_data_dir()
            .map_err(|error| {
                ConfigError::Path(format!(
                    "Tauri could not resolve the application data directory: {error}"
                ))
            })
            .and_then(ConfigStore::initialize)
            .and_then(|mut store| {
                if store.normalize_stale_vm_states() {
                    store.save()?;
                }

                Ok(Mutex::new(AppInner {
                    store,
                    runtime: HashMap::new(),
                }))
            });

        Self { inner }
    }

    pub fn with_inner<T>(
        &self,
        operation: impl FnOnce(&mut AppInner) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let inner = self
            .inner
            .as_ref()
            .map_err(|error| AppError::Config(error.clone()))?;
        let mut inner = inner
            .lock()
            .map_err(|_| AppError::Task("the application state lock was poisoned".to_string()))?;

        operation(&mut inner)
    }

    pub fn shutdown_all(&self) {
        let Ok(inner) = self.inner.as_ref() else {
            return;
        };
        let Ok(mut inner) = inner.lock() else {
            return;
        };

        let ids: Vec<String> = inner.runtime.keys().cloned().collect();
        let now = unix_now();

        for id in ids {
            if let Some(mut running) = inner.runtime.remove(&id) {
                let outcome = vm_runtime::stop(&mut running);
                if let Some(vm) = inner.store.vm_mut(&id) {
                    match outcome {
                        Ok(_) => {
                            vm.state = VmState::Stopped;
                            vm.last_error = None;
                        }
                        Err(error) => {
                            vm.state = VmState::Error;
                            vm.last_error = Some(error.to_string());
                        }
                    }
                    vm.updated_at_unix = now;
                }
            }
        }

        for vm in inner.store.vms_mut() {
            if matches!(
                vm.state,
                VmState::Starting | VmState::Running | VmState::Stopping
            ) {
                vm.state = VmState::Error;
                vm.last_error = Some(
                    "Wave VM exited before it could confirm the QEMU process state.".to_string(),
                );
                vm.updated_at_unix = now;
            }
        }

        let _ = inner.store.save();
    }
}
