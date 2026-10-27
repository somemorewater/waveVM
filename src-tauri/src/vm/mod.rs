pub mod disk;
pub mod media;
pub mod runtime;
mod validate;

use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub use validate::validate_create;

pub const GUEST_ARCH: &str = "x86_64";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VmState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BootMode {
    Installer,
    #[default]
    Disk,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmConfig {
    pub id: String,
    pub name: String,
    pub guest_arch: String,
    pub memory_mib: u32,
    pub vcpus: u32,
    pub disk_path: String,
    pub disk_size_gib: u32,
    pub state: VmState,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub install_iso_path: Option<String>,
    #[serde(default)]
    pub boot_mode: BootMode,
    pub created_at_unix: u64,
    pub updated_at_unix: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVmInput {
    pub name: String,
    pub guest_arch: String,
    pub memory_mib: u32,
    pub vcpus: u32,
    pub disk_size_gib: u32,
    #[serde(default)]
    pub install_iso_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VmSummary {
    pub id: String,
    pub name: String,
    pub guest_arch: String,
    pub memory_mib: u32,
    pub vcpus: u32,
    pub disk_path: String,
    pub disk_size_gib: u32,
    pub state: VmState,
    pub last_error: Option<String>,
    pub acceleration: Option<String>,
    pub disk_exists: bool,
    pub install_iso_path: Option<String>,
    pub install_iso_available: bool,
    pub boot_mode: BootMode,
    pub created_at_unix: u64,
    pub updated_at_unix: u64,
}

impl VmSummary {
    pub fn from_config(vm: &VmConfig, state: VmState, acceleration: Option<String>) -> Self {
        Self {
            id: vm.id.clone(),
            name: vm.name.clone(),
            guest_arch: vm.guest_arch.clone(),
            memory_mib: vm.memory_mib,
            vcpus: vm.vcpus,
            disk_path: vm.disk_path.clone(),
            disk_size_gib: vm.disk_size_gib,
            state,
            last_error: vm.last_error.clone(),
            acceleration,
            disk_exists: std::path::Path::new(&vm.disk_path).is_file(),
            install_iso_path: vm.install_iso_path.clone(),
            install_iso_available: vm
                .install_iso_path
                .as_deref()
                .map(media::iso_available)
                .unwrap_or(false),
            boot_mode: vm.boot_mode,
            created_at_unix: vm.created_at_unix,
            updated_at_unix: vm.updated_at_unix,
        }
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum VmError {
    #[error("{0}")]
    Validation(String),

    #[error("machine {0} was not found")]
    NotFound(String),

    #[error("machine {id} cannot be changed right now: {message}")]
    Busy { id: String, message: String },

    #[error("the virtual disk could not be created: {0}")]
    Disk(String),

    #[error("QEMU is unavailable: {0}")]
    QemuUnavailable(String),

    #[error("QEMU could not be started: {0}")]
    Start(String),

    #[error("QEMU could not be stopped cleanly: {0}")]
    Stop(String),

    #[error("QEMU process handling failed: {0}")]
    Process(String),

    #[error("file operation failed: {0}")]
    Io(String),

    #[error("this host or guest configuration is not supported yet: {0}")]
    Unsupported(String),
}

impl VmError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation(_) => "vm_validation_failed",
            Self::NotFound(_) => "vm_not_found",
            Self::Busy { .. } => "vm_busy",
            Self::Disk(_) => "vm_disk_failed",
            Self::QemuUnavailable(_) => "qemu_unavailable",
            Self::Start(_) => "vm_start_failed",
            Self::Stop(_) => "vm_stop_failed",
            Self::Process(_) => "vm_process_failed",
            Self::Io(_) => "vm_io_failed",
            Self::Unsupported(_) => "vm_unsupported",
        }
    }
}

pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
