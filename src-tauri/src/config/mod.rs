mod store;

pub use store::ConfigStore;

#[derive(Debug, Clone, thiserror::Error)]
pub enum ConfigError {
    #[error("application data directory could not be resolved: {0}")]
    Path(String),

    #[error("could not create directory {path}: {message}")]
    CreateDir { path: String, message: String },

    #[error("could not read configuration {path}: {message}")]
    Read { path: String, message: String },

    #[error("could not parse configuration {path}: {message}")]
    Parse { path: String, message: String },

    #[error("configuration {path} is invalid: {message}")]
    Invalid { path: String, message: String },

    #[error(
        "configuration {path} uses schema version {found}, but this build supports version {supported}"
    )]
    UnsupportedVersion {
        path: String,
        found: u64,
        supported: u32,
    },

    #[error("could not write configuration {path}: {message}")]
    Write { path: String, message: String },
}

impl ConfigError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Path(_) => "config_path_unavailable",
            Self::CreateDir { .. } => "config_directory_failed",
            Self::Read { .. } => "config_read_failed",
            Self::Parse { .. } => "config_parse_failed",
            Self::Invalid { .. } => "config_invalid",
            Self::UnsupportedVersion { .. } => "config_version_unsupported",
            Self::Write { .. } => "config_write_failed",
        }
    }
}
