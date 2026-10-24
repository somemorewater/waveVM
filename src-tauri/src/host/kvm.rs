use serde::Serialize;

const KVM_DEVICE: &str = "/dev/kvm";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KvmStatus {
    Usable,
    Missing,
    Inaccessible,
    /// Constructed by the non-Linux probe.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    Unsupported,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KvmInfo {
    pub status: KvmStatus,
    pub device_present: bool,
    pub verified: bool,
    pub api_version: Option<i32>,
    pub device_path: String,
    pub detail: String,
}

#[cfg(target_os = "linux")]
pub fn probe() -> KvmInfo {
    use std::fs::{self, OpenOptions};
    use std::os::unix::fs::FileTypeExt;
    use std::os::unix::io::AsRawFd;

    const KVM_GET_API_VERSION: libc::c_ulong = 0xAE00;
    const EXPECTED_API_VERSION: i32 = 12;

    let device = std::path::Path::new(KVM_DEVICE);

    let metadata = match fs::metadata(device) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return KvmInfo {
                status: KvmStatus::Missing,
                device_present: false,
                verified: false,
                api_version: None,
                device_path: KVM_DEVICE.to_string(),
                detail: "The /dev/kvm device does not exist on this host.".to_string(),
            };
        }
        Err(error) => {
            return KvmInfo {
                status: KvmStatus::Error,
                device_present: false,
                verified: false,
                api_version: None,
                device_path: KVM_DEVICE.to_string(),
                detail: format!("The /dev/kvm device could not be inspected: {error}"),
            };
        }
    };

    if !metadata.file_type().is_char_device() {
        return KvmInfo {
            status: KvmStatus::Error,
            device_present: true,
            verified: false,
            api_version: None,
            device_path: KVM_DEVICE.to_string(),
            detail: "A path named /dev/kvm exists, but it is not a character device.".to_string(),
        };
    }

    let file = match OpenOptions::new().read(true).write(true).open(device) {
        Ok(file) => file,
        Err(error) => {
            let status = if error.kind() == std::io::ErrorKind::PermissionDenied {
                KvmStatus::Inaccessible
            } else {
                KvmStatus::Error
            };

            return KvmInfo {
                status,
                device_present: true,
                verified: false,
                api_version: None,
                device_path: KVM_DEVICE.to_string(),
                detail: format!(
                    "The /dev/kvm device exists but could not be opened read/write: {error}. \
                     Wave VM does not change host permissions or group membership."
                ),
            };
        }
    };

    // SAFETY: the file descriptor is valid for the duration of the call, and
    // KVM_GET_API_VERSION takes no pointer argument.
    let api_version = unsafe { libc::ioctl(file.as_raw_fd(), KVM_GET_API_VERSION) };

    if api_version < 0 {
        let error = std::io::Error::last_os_error();
        return KvmInfo {
            status: KvmStatus::Error,
            device_present: true,
            verified: false,
            api_version: None,
            device_path: KVM_DEVICE.to_string(),
            detail: format!(
                "/dev/kvm was opened, but KVM_GET_API_VERSION failed: {error}. \
                 Hardware virtualization was not verified."
            ),
        };
    }

    if api_version != EXPECTED_API_VERSION {
        return KvmInfo {
            status: KvmStatus::Error,
            device_present: true,
            verified: false,
            api_version: Some(api_version),
            device_path: KVM_DEVICE.to_string(),
            detail: format!(
                "/dev/kvm responded with unexpected API version {api_version}; version {EXPECTED_API_VERSION} was expected."
            ),
        };
    }

    KvmInfo {
        status: KvmStatus::Usable,
        device_present: true,
        verified: true,
        api_version: Some(api_version),
        device_path: KVM_DEVICE.to_string(),
        detail: "Opened /dev/kvm read/write and the kernel accepted KVM_GET_API_VERSION (12)."
            .to_string(),
    }
}

#[cfg(not(target_os = "linux"))]
pub fn probe() -> KvmInfo {
    KvmInfo {
        status: KvmStatus::Unsupported,
        device_present: false,
        verified: false,
        api_version: None,
        device_path: KVM_DEVICE.to_string(),
        detail: "KVM is a Linux feature. No KVM probe was performed on this platform.".to_string(),
    }
}
