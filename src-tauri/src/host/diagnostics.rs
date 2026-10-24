use std::fs;
use std::path::Path;

use sysinfo::{Disks, System};

use super::{CheckStatus, MemoryInfo, StorageInfo};

pub fn memory_info() -> MemoryInfo {
    let mut system = System::new();
    system.refresh_memory();

    let total = system.total_memory();
    let available = system.available_memory();

    if total == 0 {
        return MemoryInfo {
            status: CheckStatus::Unsupported,
            total_bytes: None,
            available_bytes: None,
            detail: Some("The host did not report total system memory.".to_string()),
        };
    }

    MemoryInfo {
        status: CheckStatus::Ok,
        total_bytes: Some(total),
        available_bytes: if available > 0 { Some(available) } else { None },
        detail: None,
    }
}

pub fn storage_info(app_data_dir: Option<&Path>) -> StorageInfo {
    let Some(directory) = app_data_dir else {
        return StorageInfo {
            status: CheckStatus::Unsupported,
            app_data_dir: None,
            mount_point: None,
            free_bytes: None,
            total_bytes: None,
            detail: Some(
                "Tauri could not resolve the application data directory for this host.".to_string(),
            ),
        };
    };

    let app_data = directory.display().to_string();

    if let Err(error) = fs::create_dir_all(directory) {
        return StorageInfo {
            status: CheckStatus::Error,
            app_data_dir: Some(app_data),
            mount_point: None,
            free_bytes: None,
            total_bytes: None,
            detail: Some(format!(
                "The application data directory could not be created: {error}"
            )),
        };
    }

    let target = directory
        .canonicalize()
        .unwrap_or_else(|_| directory.to_path_buf());
    let disks = Disks::new_with_refreshed_list();

    let best = disks
        .list()
        .iter()
        .filter(|disk| target.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len());

    let Some(disk) = best else {
        return StorageInfo {
            status: CheckStatus::Unsupported,
            app_data_dir: Some(app_data),
            mount_point: None,
            free_bytes: None,
            total_bytes: None,
            detail: Some(
                "No mounted filesystem could be matched to the application data directory."
                    .to_string(),
            ),
        };
    };

    StorageInfo {
        status: CheckStatus::Ok,
        app_data_dir: Some(app_data),
        mount_point: Some(disk.mount_point().display().to_string()),
        free_bytes: Some(disk.available_space()),
        total_bytes: Some(disk.total_space()),
        detail: None,
    }
}
