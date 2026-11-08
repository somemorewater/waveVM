use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;
use crate::host::{self, KvmStatus};
use crate::qemu::ToolStatus;
use crate::state::{AppInner, AppState};
use crate::vm::log::{self, LogComponent, LogSeverity, VmLogView};
use crate::vm::runtime::{ConsoleSession, StopReason, Termination};
use crate::vm::{
    self, disk, media, runtime, BootMode, CreateVmInput, VmConfig, VmError, VmState, VmSummary,
};

static NEXT_VM_ID: AtomicU64 = AtomicU64::new(0);

enum RuntimeCheck {
    NotRunning,
    Running { acceleration: String },
    Exited { termination: Termination },
}

#[tauri::command]
pub async fn list_vms(app: AppHandle) -> Result<Vec<VmSummary>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(list_vms_inner)
    })
    .await
    .map_err(|error| AppError::Task(format!("VM list task failed: {error}")))?
}

fn list_vms_inner(inner: &mut AppInner) -> Result<Vec<VmSummary>, AppError> {
    let ids: Vec<String> = inner.store.vms().iter().map(|vm| vm.id.clone()).collect();
    let now = vm::unix_now();
    let mut changed = false;
    let mut summaries = Vec::with_capacity(ids.len());

    for id in ids {
        let mut acceleration = None;

        match check_runtime(inner, &id) {
            RuntimeCheck::Running {
                acceleration: value,
            } => {
                acceleration = Some(value);
            }
            RuntimeCheck::Exited { termination } => {
                if let Some(config) = inner.store.vm_mut(&id) {
                    config.state = if termination.is_failure() {
                        VmState::Error
                    } else {
                        VmState::Stopped
                    };
                    config.last_error = if termination.is_failure() {
                        Some(termination.summary)
                    } else {
                        None
                    };
                    config.updated_at_unix = now;
                    changed = true;
                }
            }
            RuntimeCheck::NotRunning => {
                let stale = inner
                    .store
                    .vm(&id)
                    .map(|vm| {
                        matches!(
                            vm.state,
                            VmState::Starting | VmState::Running | VmState::Stopping
                        )
                    })
                    .unwrap_or(false);

                if stale {
                    if let Some(config) = inner.store.vm_mut(&id) {
                        config.state = VmState::Error;
                        config.last_error = Some(
                            "Wave VM is not tracking a QEMU process for this machine. Start it again to verify its state.".to_string(),
                        );
                        config.updated_at_unix = now;
                        changed = true;
                    }
                }
            }
        }

        if let Some(config) = inner.store.vm(&id) {
            let state = if acceleration.is_some() {
                VmState::Running
            } else {
                config.state
            };
            summaries.push(VmSummary::from_config(config, state, acceleration));
        }
    }

    if changed {
        inner.store.save()?;
    }

    Ok(summaries)
}

#[tauri::command]
pub async fn create_vm(app: AppHandle, input: CreateVmInput) -> Result<VmSummary, AppError> {
    let app_data_dir = app.path().app_data_dir().ok();
    let resource_dir = app.path().resource_dir().ok();

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| {
            create_vm_inner(
                inner,
                input,
                app_data_dir.as_deref(),
                resource_dir.as_deref(),
            )
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("VM creation task failed: {error}")))?
}

#[tauri::command]
pub async fn start_vm(app: AppHandle, id: String) -> Result<VmSummary, AppError> {
    let app_data_dir = app.path().app_data_dir().ok();
    let resource_dir = app.path().resource_dir().ok();

    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| {
            start_vm_inner(inner, &id, app_data_dir.as_deref(), resource_dir.as_deref())
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("VM start task failed: {error}")))?
}

#[tauri::command]
pub async fn stop_vm(app: AppHandle, id: String) -> Result<VmSummary, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| stop_vm_inner(inner, &id))
    })
    .await
    .map_err(|error| AppError::Task(format!("VM stop task failed: {error}")))?
}

#[tauri::command]
pub async fn get_vm_console(app: AppHandle, id: String) -> Result<ConsoleSession, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state.with_inner(|inner| {
            let Some(running) = inner.runtime.get_mut(&id) else {
                return Err(VmError::Busy {
                    id: id.clone(),
                    message: "the machine is not running, so its console is unavailable"
                        .to_string(),
                }
                .into());
            };

            match running.child.try_wait() {
                Ok(None) => Ok(running.console.clone()),
                Ok(Some(status)) => {
                    let termination = running.finish_unexpected(status);
                    inner.runtime.remove(&id);

                    if let Some(config) = inner.store.vm_mut(&id) {
                        config.state = if termination.is_failure() {
                            VmState::Error
                        } else {
                            VmState::Stopped
                        };
                        config.last_error = if termination.is_failure() {
                            Some(termination.summary.clone())
                        } else {
                            None
                        };
                        config.updated_at_unix = vm::unix_now();
                        let _ = inner.store.save();
                    }

                    Err(VmError::Busy {
                        id: id.clone(),
                        message: termination.summary,
                    }
                    .into())
                }
                Err(error) => Err(VmError::Process(format!(
                    "could not inspect the QEMU process: {error}"
                ))
                .into()),
            }
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("VM console task failed: {error}")))?
}

#[tauri::command]
pub async fn get_vm_logs(
    app: AppHandle,
    id: String,
    session_id: Option<String>,
) -> Result<VmLogView, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (logs_dir, vm_id, current_session) = state.with_inner(|inner| {
            let vm = inner
                .store
                .vm(&id)
                .ok_or_else(|| VmError::NotFound(id.clone()))?;
            let logs_dir = inner.store.vms_dir().join(&vm.id).join("logs");
            let current_session = inner
                .runtime
                .get(&id)
                .map(|running| running.log_session_id().to_string());

            Ok((logs_dir, vm.id.clone(), current_session))
        })?;

        log::read_view(
            &logs_dir,
            &vm_id,
            current_session.as_deref(),
            session_id.as_deref(),
        )
        .map_err(|error| {
            VmError::Io(format!("the diagnostic log could not be read: {error}")).into()
        })
    })
    .await
    .map_err(|error| AppError::Task(format!("VM log task failed: {error}")))?
}

#[tauri::command]
pub async fn export_vm_log(
    app: AppHandle,
    id: String,
    session_id: Option<String>,
) -> Result<Option<String>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let (log_path, suggested_name) = state.with_inner(|inner| {
            let vm = inner
                .store
                .vm(&id)
                .ok_or_else(|| VmError::NotFound(id.clone()))?;
            let logs_dir = inner.store.vms_dir().join(&vm.id).join("logs");
            let current_session = inner
                .runtime
                .get(&id)
                .map(|running| running.log_session_id().to_string());
            let sessions = log::list_sessions(&logs_dir, current_session.as_deref());
            let selected =
                log::select_session(&sessions, current_session.as_deref(), session_id.as_deref())
                    .ok_or_else(|| {
                    VmError::Io(
                        "no diagnostic log session is available for this machine".to_string(),
                    )
                })?;
            let suggested_name = format!(
                "wave-vm-{}-{}.log",
                sanitize_file_component(&vm.name),
                selected.session_id
            );

            Ok((PathBuf::from(&selected.log_path), suggested_name))
        })?;

        let selected = app
            .dialog()
            .file()
            .set_title("Export Wave VM diagnostic log")
            .set_file_name(&suggested_name)
            .add_filter("Log files", &["log", "txt"])
            .blocking_save_file();

        let Some(file) = selected else {
            return Ok(None);
        };

        let destination = file.into_path().map_err(|error| {
            AppError::Task(format!("the export path could not be read: {error}"))
        })?;
        let content = log::read_session_text(&log_path).map_err(|error| {
            VmError::Io(format!("the diagnostic log could not be read: {error}"))
        })?;
        std::fs::write(&destination, content).map_err(|error| {
            VmError::Io(format!(
                "the diagnostic log could not be written to {}: {error}",
                destination.display()
            ))
        })?;

        Ok(Some(destination.display().to_string()))
    })
    .await
    .map_err(|error| AppError::Task(format!("VM log export task failed: {error}")))?
}

fn create_vm_inner(
    inner: &mut AppInner,
    input: CreateVmInput,
    app_data_dir: Option<&Path>,
    resource_dir: Option<&Path>,
) -> Result<VmSummary, AppError> {
    let host = host::detect(app_data_dir, resource_dir);
    let validated = vm::validate_create(&input, &host)?;

    if !matches!(host.qemu_img.status, ToolStatus::Available) {
        return Err(VmError::QemuUnavailable(
            host.qemu_img
                .detail
                .unwrap_or_else(|| "qemu-img was not found on this host.".to_string()),
        )
        .into());
    }

    let qemu_img = host.qemu_img.path.as_deref().ok_or_else(|| {
        VmError::QemuUnavailable("qemu-img did not report an executable path.".to_string())
    })?;

    let install_iso_path = match input.install_iso_path.as_deref() {
        Some(value) if !value.trim().is_empty() => Some(media::validate_iso_file(value)?),
        _ => None,
    };
    let boot_mode = if install_iso_path.is_some() {
        BootMode::Installer
    } else {
        BootMode::Disk
    };

    let id = generate_vm_id();
    let vm_dir = inner.store.vms_dir().join(&id);
    let disk_path = vm_dir.join("disk.qcow2");
    let disk_path_string = disk_path
        .to_str()
        .ok_or_else(|| {
            VmError::Unsupported(
                "the application data path must be valid UTF-8 to store a VM disk path".to_string(),
            )
        })?
        .to_string();

    if disk_path_string.contains(',')
        || disk_path_string.contains('\n')
        || disk_path_string.contains('\r')
    {
        return Err(VmError::Unsupported(
            "the application data path contains a character QEMU option parsing cannot safely accept"
                .to_string(),
        )
        .into());
    }

    #[cfg(unix)]
    if vm_dir.join("qmp.sock").to_string_lossy().len() > 100 {
        return Err(VmError::Unsupported(
            "the application data path is too long for the private QMP Unix socket".to_string(),
        )
        .into());
    }

    create_private_directory(&vm_dir)?;

    if let Err(error) = disk::create_qcow2(Path::new(qemu_img), &disk_path, validated.disk_size_gib)
    {
        let _ = fs::remove_dir(&vm_dir);
        return Err(error.into());
    }

    let now = vm::unix_now();
    let config = VmConfig {
        id: id.clone(),
        name: validated.name,
        guest_arch: validated.guest_arch,
        memory_mib: validated.memory_mib,
        vcpus: validated.vcpus,
        disk_path: disk_path_string,
        disk_size_gib: validated.disk_size_gib,
        state: VmState::Stopped,
        last_error: None,
        install_iso_path,
        boot_mode,
        network: validated.network,
        created_at_unix: now,
        updated_at_unix: now,
    };

    inner.store.add_vm(config);

    if let Err(error) = inner.store.save() {
        inner.store.remove_vm(&id);
        return Err(AppError::Config(error));
    }

    let vm = inner
        .store
        .vm(&id)
        .ok_or_else(|| VmError::NotFound(id.clone()))?;
    Ok(VmSummary::from_config(vm, VmState::Stopped, None))
}

fn start_vm_inner(
    inner: &mut AppInner,
    id: &str,
    app_data_dir: Option<&Path>,
    resource_dir: Option<&Path>,
) -> Result<VmSummary, AppError> {
    let vm = inner
        .store
        .vm(id)
        .cloned()
        .ok_or_else(|| VmError::NotFound(id.to_string()))?;

    if let RuntimeCheck::Running { .. } = check_runtime(inner, id) {
        return Err(VmError::Busy {
            id: id.to_string(),
            message: "a QEMU process is already running for this machine".to_string(),
        }
        .into());
    }

    let disk_path = validate_disk_path(inner.store.vms_dir(), Path::new(&vm.disk_path))?;
    let host = host::detect(app_data_dir, resource_dir);

    if !matches!(host.qemu.status, ToolStatus::Available) {
        return Err(VmError::QemuUnavailable(
            host.qemu
                .detail
                .unwrap_or_else(|| "QEMU was not found on this host.".to_string()),
        )
        .into());
    }

    let qemu = host.qemu.path.as_deref().ok_or_else(|| {
        VmError::QemuUnavailable("QEMU did not report an executable path.".to_string())
    })?;

    let install_iso = match vm.boot_mode {
        BootMode::Installer => {
            let raw = vm.install_iso_path.as_deref().ok_or_else(|| {
                VmError::Validation(
                    "installer boot is selected, but no installation ISO is attached".to_string(),
                )
            })?;
            Some(media::validate_iso_file(raw)?)
        }
        BootMode::Disk => None,
    };

    update_vm_state(inner, id, VmState::Starting, None)?;

    let kvm_usable = matches!(host.kvm.status, KvmStatus::Usable);
    let launch = runtime::launch(
        &vm,
        Path::new(qemu),
        host.qemu.version.as_deref(),
        &disk_path,
        kvm_usable,
        install_iso.as_deref().map(Path::new),
    );

    match launch {
        Ok(running) => {
            let acceleration = running.acceleration.clone();
            inner.runtime.insert(id.to_string(), running);

            if let Err(error) = update_vm_state(inner, id, VmState::Running, None) {
                if let Some(mut running) = inner.runtime.remove(id) {
                    running.record(
                        LogSeverity::Error,
                        LogComponent::Vm,
                        "QEMU started, but the running state could not be persisted; stopping it.",
                    );
                    let _ = runtime::stop(&mut running, StopReason::StartupFailure);
                }
                let _ = update_vm_state(
                    inner,
                    id,
                    VmState::Error,
                    Some("QEMU started, but the running state could not be persisted.".to_string()),
                );
                return Err(error);
            }

            let vm = inner
                .store
                .vm(id)
                .ok_or_else(|| VmError::NotFound(id.to_string()))?;
            Ok(VmSummary::from_config(
                vm,
                VmState::Running,
                Some(acceleration),
            ))
        }
        Err(error) => {
            let message = error.to_string();
            let _ = update_vm_state(inner, id, VmState::Error, Some(message));
            Err(error.into())
        }
    }
}

fn stop_vm_inner(inner: &mut AppInner, id: &str) -> Result<VmSummary, AppError> {
    if inner.store.vm(id).is_none() {
        return Err(VmError::NotFound(id.to_string()).into());
    }

    let Some(mut running) = inner.runtime.remove(id) else {
        if let Some(config) = inner.store.vm_mut(id) {
            if matches!(
                config.state,
                VmState::Starting | VmState::Running | VmState::Stopping
            ) {
                config.state = VmState::Stopped;
                config.last_error =
                    Some("Wave VM was not tracking a QEMU process for this machine.".to_string());
                config.updated_at_unix = vm::unix_now();
                let _ = inner.store.save();
            }
        }

        return Err(VmError::Busy {
            id: id.to_string(),
            message: "it is not running".to_string(),
        }
        .into());
    };

    if let Err(error) = update_vm_state(inner, id, VmState::Stopping, None) {
        if let Some(config) = inner.store.vm_mut(id) {
            config.state = VmState::Running;
        }
        inner.runtime.insert(id.to_string(), running);
        return Err(error);
    }

    match runtime::stop(&mut running, StopReason::User) {
        Ok(outcome) => {
            let last_error = if outcome.termination.severity == LogSeverity::Info {
                None
            } else {
                Some(outcome.termination.summary)
            };

            update_vm_state(inner, id, VmState::Stopped, last_error)?;

            let vm = inner
                .store
                .vm(id)
                .ok_or_else(|| VmError::NotFound(id.to_string()))?;
            Ok(VmSummary::from_config(vm, VmState::Stopped, None))
        }
        Err(error) => {
            let message = error.to_string();
            running.record(
                LogSeverity::Error,
                LogComponent::Vm,
                &format!("Shutdown failed: {message}"),
            );

            match running.child.try_wait() {
                Ok(None) => {
                    inner.runtime.insert(id.to_string(), running);
                }
                Ok(Some(status)) => {
                    running.finish_unexpected(status);
                }
                Err(_) => {
                    inner.runtime.insert(id.to_string(), running);
                }
            }

            let _ = update_vm_state(inner, id, VmState::Error, Some(message));
            Err(error.into())
        }
    }
}

fn check_runtime(inner: &mut AppInner, id: &str) -> RuntimeCheck {
    let termination = {
        let Some(running) = inner.runtime.get_mut(id) else {
            return RuntimeCheck::NotRunning;
        };

        match running.child.try_wait() {
            Ok(None) => {
                return RuntimeCheck::Running {
                    acceleration: running.acceleration.clone(),
                };
            }
            Ok(Some(status)) => Some(running.finish_unexpected(status)),
            Err(error) => {
                running.record(
                    LogSeverity::Warn,
                    LogComponent::Vm,
                    &format!("Could not inspect the QEMU process: {error}"),
                );
                return RuntimeCheck::Running {
                    acceleration: running.acceleration.clone(),
                };
            }
        }
    };

    inner.runtime.remove(id);

    let termination = termination.expect("a termination exists when the process is not running");
    RuntimeCheck::Exited { termination }
}

fn update_vm_state(
    inner: &mut AppInner,
    id: &str,
    state: VmState,
    last_error: Option<String>,
) -> Result<(), AppError> {
    let Some(config) = inner.store.vm_mut(id) else {
        return Err(VmError::NotFound(id.to_string()).into());
    };

    config.state = state;
    config.last_error = last_error;
    config.updated_at_unix = vm::unix_now();
    inner.store.save()?;
    Ok(())
}

fn validate_disk_path(vms_dir: &Path, disk_path: &Path) -> Result<PathBuf, VmError> {
    if !disk_path.is_file() {
        return Err(VmError::Disk(format!(
            "the virtual disk {} is missing",
            disk_path.display()
        )));
    }

    let canonical_vms = vms_dir.canonicalize().map_err(|error| {
        VmError::Io(format!(
            "the VM directory {} could not be resolved: {error}",
            vms_dir.display()
        ))
    })?;
    let canonical_disk = disk_path.canonicalize().map_err(|error| {
        VmError::Io(format!(
            "the virtual disk {} could not be resolved: {error}",
            disk_path.display()
        ))
    })?;

    if !canonical_disk.starts_with(&canonical_vms) {
        return Err(VmError::Validation(format!(
            "the virtual disk {} is outside the Wave VM data directory",
            disk_path.display()
        )));
    }

    Ok(canonical_disk)
}

fn create_private_directory(path: &Path) -> Result<(), VmError> {
    fs::create_dir(path).map_err(|error| {
        VmError::Io(format!(
            "the machine directory {} could not be created: {error}",
            path.display()
        ))
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            VmError::Io(format!(
                "the machine directory {} could not be restricted: {error}",
                path.display()
            ))
        })?;
    }

    Ok(())
}

fn generate_vm_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let counter = NEXT_VM_ID.fetch_add(1, Ordering::Relaxed);

    format!("vm-{nanos:x}-{:x}-{counter:x}", process::id())
}

fn sanitize_file_component(value: &str) -> String {
    let mut sanitized = String::new();

    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            sanitized.push(character.to_ascii_lowercase());
        } else if character.is_whitespace() || matches!(character, '-' | '_' | '.') {
            sanitized.push('-');
        }

        if sanitized.len() >= 40 {
            break;
        }
    }

    let trimmed = sanitized.trim_matches('-').to_string();

    if trimmed.is_empty() {
        "machine".to_string()
    } else {
        trimmed
    }
}
