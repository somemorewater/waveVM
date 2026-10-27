use serde::ser::{Serialize, SerializeStruct, Serializer};

use crate::config::ConfigError;
use crate::vm::VmError;

#[derive(Debug, Clone, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Config(#[from] ConfigError),

    #[error("{0}")]
    Vm(#[from] VmError),

    #[error("background task failed: {0}")]
    Task(String),

    #[error("window operation failed: {0}")]
    Window(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(error) => error.code(),
            Self::Vm(error) => error.code(),
            Self::Task(_) => "background_task_failed",
            Self::Window(_) => "window_operation_failed",
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
