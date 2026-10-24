use std::fs::{self, OpenOptions};
use std::io::Write;

#[cfg(unix)]
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ConfigError;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub created_at_unix: u64,
    pub last_opened_unix: u64,
}

pub struct ConfigStore {
    data_dir: PathBuf,
    config_path: PathBuf,
    vms_dir: PathBuf,
    config: AppConfig,
}

impl ConfigStore {
    pub fn initialize(data_dir: PathBuf) -> Result<Self, ConfigError> {
        ensure_directory(&data_dir)?;

        let vms_dir = data_dir.join("vms");
        ensure_directory(&vms_dir)?;

        let config_path = data_dir.join("config.json");
        let now = unix_now();

        let mut config = if config_path
            .try_exists()
            .map_err(|error| ConfigError::Read {
                path: config_path.display().to_string(),
                message: error.to_string(),
            })? {
            load_config(&config_path)?
        } else {
            AppConfig {
                schema_version: SCHEMA_VERSION,
                created_at_unix: now,
                last_opened_unix: now,
            }
        };

        migrate(&mut config, &config_path)?;

        if config.created_at_unix == 0 {
            config.created_at_unix = now;
        }
        config.last_opened_unix = now;

        write_atomic(&config_path, &config)?;

        Ok(Self {
            data_dir,
            config_path,
            vms_dir,
            config,
        })
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn config_path(&self) -> &Path {
        &self.config_path
    }

    pub fn vms_dir(&self) -> &Path {
        &self.vms_dir
    }

    pub fn config(&self) -> &AppConfig {
        &self.config
    }
}

fn load_config(path: &Path) -> Result<AppConfig, ConfigError> {
    let bytes = fs::read(path).map_err(|error| ConfigError::Read {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    let value: Value = serde_json::from_slice(&bytes).map_err(|error| ConfigError::Parse {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    let version = value
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| ConfigError::Invalid {
            path: path.display().to_string(),
            message: "the schemaVersion field is missing or is not an unsigned integer".to_string(),
        })?;

    if version > u64::from(SCHEMA_VERSION) {
        return Err(ConfigError::UnsupportedVersion {
            path: path.display().to_string(),
            found: version,
            supported: SCHEMA_VERSION,
        });
    }

    serde_json::from_value(value).map_err(|error| ConfigError::Parse {
        path: path.display().to_string(),
        message: error.to_string(),
    })
}

fn migrate(config: &mut AppConfig, path: &Path) -> Result<(), ConfigError> {
    match config.schema_version {
        SCHEMA_VERSION => Ok(()),
        0 => {
            config.schema_version = SCHEMA_VERSION;
            Ok(())
        }
        found => Err(ConfigError::UnsupportedVersion {
            path: path.display().to_string(),
            found: u64::from(found),
            supported: SCHEMA_VERSION,
        }),
    }
}

fn ensure_directory(path: &Path) -> Result<(), ConfigError> {
    fs::create_dir_all(path).map_err(|error| ConfigError::CreateDir {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            ConfigError::CreateDir {
                path: path.display().to_string(),
                message: error.to_string(),
            }
        })?;
    }

    Ok(())
}

fn write_atomic(path: &Path, config: &AppConfig) -> Result<(), ConfigError> {
    let parent = path.parent().ok_or_else(|| ConfigError::Write {
        path: path.display().to_string(),
        message: "the configuration path has no parent directory".to_string(),
    })?;

    let mut bytes = serde_json::to_vec_pretty(config).map_err(|error| ConfigError::Write {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;
    bytes.push(b'\n');

    let temporary = parent.join(format!(
        ".config.json.tmp-{}-{}",
        process::id(),
        unix_nanos()
    ));

    let write_result = write_temporary(&temporary, &bytes).and_then(|()| {
        fs::rename(&temporary, path).map_err(|error| ConfigError::Write {
            path: path.display().to_string(),
            message: error.to_string(),
        })
    });

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
        return write_result;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            ConfigError::Write {
                path: path.display().to_string(),
                message: error.to_string(),
            }
        })?;

        if let Ok(directory) = File::open(parent) {
            let _ = directory.sync_all();
        }
    }

    Ok(())
}

fn write_temporary(path: &Path, bytes: &[u8]) -> Result<(), ConfigError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options.open(path).map_err(|error| ConfigError::Write {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    file.write_all(bytes).map_err(|error| ConfigError::Write {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;

    file.sync_all().map_err(|error| ConfigError::Write {
        path: path.display().to_string(),
        message: error.to_string(),
    })
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}
