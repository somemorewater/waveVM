use tauri::{AppHandle, Manager};

use crate::config::{ConfigError, ConfigStore};
use crate::error::AppError;

pub struct AppState {
    config: Result<ConfigStore, ConfigError>,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Self {
        let config = app
            .path()
            .app_data_dir()
            .map_err(|error| {
                ConfigError::Path(format!(
                    "Tauri could not resolve the application data directory: {error}"
                ))
            })
            .and_then(ConfigStore::initialize);

        Self { config }
    }

    pub fn config(&self) -> Result<&ConfigStore, AppError> {
        self.config
            .as_ref()
            .map_err(|error| AppError::Config(error.clone()))
    }
}
