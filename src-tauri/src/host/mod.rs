mod diagnostics;
mod kvm;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::qemu::{discover_qemu_img, discover_system_emulator, ToolInfo, ToolStatus};

pub use kvm::{KvmInfo, KvmStatus};

const LOW_DISK_BYTES: u64 = 10 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Ok,
    Unsupported,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub status: CheckStatus,
    pub total_bytes: Option<u64>,
    pub available_bytes: Option<u64>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub status: CheckStatus,
    pub app_data_dir: Option<String>,
    pub mount_point: Option<String>,
    pub free_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub os: String,
    pub arch: String,
    pub cpu_logical: Option<usize>,
    pub memory: MemoryInfo,
    pub storage: StorageInfo,
    pub qemu: ToolInfo,
    pub qemu_img: ToolInfo,
    pub kvm: KvmInfo,
    pub warnings: Vec<HostWarning>,
    pub collected_at_unix: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WarningSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostWarning {
    pub severity: WarningSeverity,
    pub code: String,
    pub title: String,
    pub message: String,
}

pub fn detect(app_data_dir: Option<&Path>, resource_dir: Option<&Path>) -> HostInfo {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let cpu_logical = std::thread::available_parallelism()
        .ok()
        .map(|count| count.get());

    let memory = diagnostics::memory_info();
    let storage = diagnostics::storage_info(app_data_dir);
    let qemu = discover_system_emulator(resource_dir, &arch);
    let qemu_img = discover_qemu_img(resource_dir);
    let kvm = kvm::probe();

    let warnings = build_warnings(&qemu, &qemu_img, &kvm, &storage, &memory, cpu_logical);

    HostInfo {
        os,
        arch,
        cpu_logical,
        memory,
        storage,
        qemu,
        qemu_img,
        kvm,
        warnings,
        collected_at_unix: unix_now(),
    }
}

fn build_warnings(
    qemu: &ToolInfo,
    qemu_img: &ToolInfo,
    kvm: &KvmInfo,
    storage: &StorageInfo,
    memory: &MemoryInfo,
    cpu_logical: Option<usize>,
) -> Vec<HostWarning> {
    let mut warnings = Vec::new();

    match qemu.status {
        ToolStatus::Available => {}
        ToolStatus::Missing => warnings.push(warning(
            WarningSeverity::Warning,
            "qemu_missing",
            "QEMU was not found",
            detail_or(
                qemu,
                "Install QEMU or provide a bundled copy to enable VM operations in a later milestone.",
            ),
        )),
        ToolStatus::Failed => warnings.push(warning(
            WarningSeverity::Error,
            "qemu_probe_failed",
            "QEMU could not be verified",
            detail_or(qemu, "The QEMU executable was found but could not be started."),
        )),
        ToolStatus::Unsupported => warnings.push(warning(
            WarningSeverity::Info,
            "qemu_unsupported",
            "QEMU discovery is not mapped for this architecture",
            detail_or(
                qemu,
                "The application has no default QEMU system executable for this host architecture.",
            ),
        )),
    }

    match qemu_img.status {
        ToolStatus::Available => {}
        ToolStatus::Missing => warnings.push(warning(
            WarningSeverity::Warning,
            "qemu_img_missing",
            "qemu-img was not found",
            detail_or(
                qemu_img,
                "qemu-img is required for disk image operations in a later milestone.",
            ),
        )),
        ToolStatus::Failed => warnings.push(warning(
            WarningSeverity::Error,
            "qemu_img_probe_failed",
            "qemu-img could not be verified",
            detail_or(
                qemu_img,
                "The qemu-img executable was found but could not be started.",
            ),
        )),
        ToolStatus::Unsupported => warnings.push(warning(
            WarningSeverity::Info,
            "qemu_img_unsupported",
            "qemu-img discovery is unavailable",
            detail_or(
                qemu_img,
                "qemu-img discovery is not supported on this platform.",
            ),
        )),
    }

    match kvm.status {
        KvmStatus::Usable => {}
        KvmStatus::Missing => warnings.push(warning(
            WarningSeverity::Warning,
            "kvm_missing",
            "KVM is not available",
            kvm.detail.clone(),
        )),
        KvmStatus::Inaccessible => warnings.push(warning(
            WarningSeverity::Warning,
            "kvm_inaccessible",
            "KVM is not accessible",
            kvm.detail.clone(),
        )),
        KvmStatus::Error => warnings.push(warning(
            WarningSeverity::Error,
            "kvm_probe_failed",
            "KVM could not be verified",
            kvm.detail.clone(),
        )),
        KvmStatus::Unsupported => warnings.push(warning(
            WarningSeverity::Info,
            "kvm_unsupported",
            "KVM probing is not applicable on this platform",
            kvm.detail.clone(),
        )),
    }

    match storage.status {
        CheckStatus::Ok => {
            if let Some(free_bytes) = storage.free_bytes {
                if free_bytes < LOW_DISK_BYTES {
                    warnings.push(warning(
                        WarningSeverity::Warning,
                        "disk_space_low",
                        "Free disk space is low",
                        format!(
                            "Only {} GiB is free on the application data filesystem. Future disk images may need more space.",
                            free_bytes / (1024 * 1024 * 1024)
                        ),
                    ));
                }
            }
        }
        CheckStatus::Unsupported => warnings.push(warning(
            WarningSeverity::Info,
            "storage_unavailable",
            "Free disk space could not be determined",
            detail_or_storage(storage),
        )),
        CheckStatus::Error => warnings.push(warning(
            WarningSeverity::Warning,
            "storage_error",
            "Application data storage is unavailable",
            detail_or_storage(storage),
        )),
    }

    if memory.status != CheckStatus::Ok {
        warnings.push(warning(
            WarningSeverity::Info,
            "memory_unavailable",
            "System memory information is unavailable",
            memory.detail.clone().unwrap_or_else(|| {
                "The host did not report usable memory information.".to_string()
            }),
        ));
    }

    if cpu_logical.is_none() {
        warnings.push(warning(
            WarningSeverity::Info,
            "cpu_count_unavailable",
            "Logical CPU count is unavailable",
            "The host did not report a usable logical CPU count.".to_string(),
        ));
    }

    warnings
}

fn warning(severity: WarningSeverity, code: &str, title: &str, message: String) -> HostWarning {
    HostWarning {
        severity,
        code: code.to_string(),
        title: title.to_string(),
        message,
    }
}

fn detail_or(tool: &ToolInfo, fallback: &str) -> String {
    tool.detail
        .clone()
        .or_else(|| tool.path.clone())
        .unwrap_or_else(|| fallback.to_string())
}

fn detail_or_storage(storage: &StorageInfo) -> String {
    storage
        .detail
        .clone()
        .unwrap_or_else(|| "The host did not provide storage information.".to_string())
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
