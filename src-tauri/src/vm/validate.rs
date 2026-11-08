use crate::host::HostInfo;

use super::{CreateVmInput, NetworkAdapter, NetworkConfig, NetworkMode, VmError, GUEST_ARCH};

const MIN_MEMORY_MIB: u64 = 256;
const MAX_MEMORY_MIB: u64 = 65_536;
const MIN_VCPUS: u32 = 1;
const MAX_VCPUS: u32 = 64;
const MIN_DISK_GIB: u64 = 1;
const MAX_DISK_GIB: u64 = 1_024;

pub struct ValidatedCreate {
    pub name: String,
    pub guest_arch: String,
    pub memory_mib: u32,
    pub vcpus: u32,
    pub disk_size_gib: u32,
    pub network: NetworkConfig,
}

pub fn validate_create(input: &CreateVmInput, host: &HostInfo) -> Result<ValidatedCreate, VmError> {
    if host.os != "linux" || host.arch != "x86_64" {
        return Err(VmError::Unsupported(format!(
            "the VM lifecycle currently requires a Linux x86_64 host; this host reports {} {}",
            host.os, host.arch
        )));
    }

    let name = validate_name(&input.name)?;

    if input.guest_arch != GUEST_ARCH {
        return Err(VmError::Validation(format!(
            "only x86_64 guests are supported in this milestone; received \"{}\"",
            input.guest_arch
        )));
    }

    let memory_mib = u64::from(input.memory_mib);
    if !(MIN_MEMORY_MIB..=MAX_MEMORY_MIB).contains(&memory_mib) {
        return Err(VmError::Validation(format!(
            "memory must be between {MIN_MEMORY_MIB} and {MAX_MEMORY_MIB} MiB"
        )));
    }

    if let Some(total_bytes) = host.memory.total_bytes {
        let total_mib = total_bytes / (1024 * 1024);
        if memory_mib > total_mib {
            return Err(VmError::Validation(format!(
                "memory cannot exceed the host's total memory of {total_mib} MiB"
            )));
        }
    }

    if !(MIN_VCPUS..=MAX_VCPUS).contains(&input.vcpus) {
        return Err(VmError::Validation(format!(
            "virtual CPUs must be between {MIN_VCPUS} and {MAX_VCPUS}"
        )));
    }

    if let Some(logical) = host.cpu_logical {
        if u64::from(input.vcpus) > logical as u64 {
            return Err(VmError::Validation(format!(
                "virtual CPUs cannot exceed the host's {logical} logical CPUs"
            )));
        }
    }

    let disk_size_gib = u64::from(input.disk_size_gib);
    if !(MIN_DISK_GIB..=MAX_DISK_GIB).contains(&disk_size_gib) {
        return Err(VmError::Validation(format!(
            "disk size must be between {MIN_DISK_GIB} and {MAX_DISK_GIB} GiB"
        )));
    }

    if let Some(free_bytes) = host.storage.free_bytes {
        let required = disk_size_gib.saturating_mul(1024 * 1024 * 1024);
        if required > free_bytes {
            return Err(VmError::Validation(format!(
                "the requested {disk_size_gib} GiB disk exceeds the {} GiB free on the application data filesystem",
                free_bytes / (1024 * 1024 * 1024)
            )));
        }
    }

    let network = validate_network(input)?;

    Ok(ValidatedCreate {
        name,
        guest_arch: GUEST_ARCH.to_string(),
        memory_mib: input.memory_mib,
        vcpus: input.vcpus,
        disk_size_gib: input.disk_size_gib,
        network,
    })
}

fn validate_network(input: &CreateVmInput) -> Result<NetworkConfig, VmError> {
    match input.network_mode {
        NetworkMode::Nat => {}
        mode => {
            return Err(VmError::Validation(format!(
                "the {} network mode is planned but not implemented; only NAT is available",
                mode.label()
            )));
        }
    }

    match input.network_adapter {
        NetworkAdapter::Virtio => {}
    }

    Ok(NetworkConfig {
        enabled: input.network_enabled,
        mode: input.network_mode,
        adapter: input.network_adapter,
    })
}

fn validate_name(value: &str) -> Result<String, VmError> {
    let name = value.trim();

    if name.is_empty() {
        return Err(VmError::Validation(
            "the machine name cannot be empty".to_string(),
        ));
    }

    if name.chars().count() > 64 {
        return Err(VmError::Validation(
            "the machine name cannot be longer than 64 characters".to_string(),
        ));
    }

    if name.chars().any(char::is_control) {
        return Err(VmError::Validation(
            "the machine name cannot contain control characters".to_string(),
        ));
    }

    if name
        .chars()
        .any(|character| matches!(character, '/' | '\\' | ',' | '='))
    {
        return Err(VmError::Validation(
            "the machine name cannot contain /, \\, comma, or equals characters".to_string(),
        ));
    }

    Ok(name.to_string())
}
