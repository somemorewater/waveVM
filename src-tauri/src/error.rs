use serde::ser::{Serialize, SerializeStruct, Serializer};

use crate::config::ConfigError;

#[derive(Debug, Clone, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Config(#[from] ConfigError),

    #[error("background task failed: {0}")]
    Task(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(error) => error.code(),
            Self::Task(_) => "background_task_failed",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}
