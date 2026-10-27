use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::qmp::QmpClient;

use super::{VmConfig, VmError};

const QMP_START_TIMEOUT: Duration = Duration::from_secs(3);
const QMP_POWERDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const QMP_QUIT_TIMEOUT: Duration = Duration::from_secs(3);
const SIGTERM_TIMEOUT: Duration = Duration::from_secs(2);
const LOG_TAIL_BYTES: u64 = 16 * 1024;
const VNC_OPTIONS: &str = "127.0.0.1:0,to=99,websocket=on,password=on";
const VNC_PASSWORD_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSession {
    pub ws_url: String,
    pub password: String,
}

pub struct RunningVm {
    pub child: Child,
    pub qmp_path: PathBuf,
    pub log_path: PathBuf,
    pub acceleration: String,
    pub console: ConsoleSession,
}

pub struct StopOutcome {
    pub status: Option<ExitStatus>,
}

pub fn launch(
    vm: &VmConfig,
    qemu_path: &Path,
    disk_path: &Path,
    kvm_usable: bool,
    install_iso: Option<&Path>,
) -> Result<RunningVm, VmError> {
    let vm_dir = disk_path.parent().ok_or_else(|| {
        VmError::Start("the virtual disk path has no parent directory".to_string())
    })?;
    let qmp_path = vm_dir.join("qmp.sock");
    let log_path = vm_dir.join("qemu.log");

    validate_qemu_path(disk_path, "virtual disk path")?;
    validate_qemu_path(&qmp_path, "QMP socket path")?;

    #[cfg(unix)]
    if qmp_path.to_string_lossy().len() > 100 {
        return Err(VmError::Start(format!(
            "the QMP socket path is too long for a Unix socket: {}",
            qmp_path.display()
        )));
    }

    if qmp_path.exists() {
        if QmpClient::connect(&qmp_path).is_ok() {
            return Err(VmError::Busy {
                id: vm.id.clone(),
                message: "a live QMP endpoint already exists for this machine; another QEMU process may still be running".to_string(),
            });
        }
    }

    match fs::remove_file(&qmp_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(VmError::Start(format!(
                "the stale QMP socket {} could not be removed: {error}",
                qmp_path.display()
            )));
        }
    }

    let accelerators: &[&str] = if kvm_usable {
        &["kvm", "tcg"]
    } else {
        &["tcg"]
    };
    let mut kvm_error = None;

    for (index, accelerator) in accelerators.iter().enumerate() {
        match launch_once(
            vm,
            qemu_path,
            disk_path,
            &qmp_path,
            &log_path,
            accelerator,
            install_iso,
        ) {
            Ok(running) => return Ok(running),
            Err(error) => {
                if *accelerator == "kvm" && index + 1 < accelerators.len() {
                    kvm_error = Some(error.to_string());
                    continue;
                }

                let message = match kvm_error {
                    Some(kvm_error) => {
                        format!("{error} (the KVM attempt also failed: {kvm_error})")
                    }
                    None => error.to_string(),
                };
                return Err(VmError::Start(message));
            }
        }
    }

    Err(VmError::Start(
        "no usable QEMU accelerator was selected".to_string(),
    ))
}

fn launch_once(
    vm: &VmConfig,
    qemu_path: &Path,
    disk_path: &Path,
    qmp_path: &Path,
    log_path: &Path,
    accelerator: &str,
    install_iso: Option<&Path>,
) -> Result<RunningVm, VmError> {
    let mut log = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(log_path)
        .map_err(|error| {
            VmError::Start(format!(
                "the QEMU log {} could not be opened: {error}",
                log_path.display()
            ))
        })?;

    let _ = writeln!(
        log,
        "Wave VM QEMU log\naccelerator={accelerator}\nmachine={}\n",
        vm.id
    );

    let stdout = log
        .try_clone()
        .map_err(|error| VmError::Start(format!("the QEMU log could not be cloned: {error}")))?;
    let stderr = log
        .try_clone()
        .map_err(|error| VmError::Start(format!("the QEMU log could not be cloned: {error}")))?;

    let drive = format!("file={},if=virtio,format=qcow2", disk_path.display());
    let qmp = format!("unix:{},server=on,wait=off", qmp_path.display());

    if let Some(iso) = install_iso {
        validate_qemu_path(iso, "installation ISO path")?;
    }

    let mut command = Command::new(qemu_path);
    command
        .arg("-name")
        .arg(format!("wave-vm-{}", vm.id))
        .arg("-machine")
        .arg("q35")
        .arg("-accel")
        .arg(accelerator)
        .arg("-m")
        .arg(format!("{}M", vm.memory_mib))
        .arg("-smp")
        .arg(vm.vcpus.to_string())
        .arg("-drive")
        .arg(drive);

    if let Some(iso) = install_iso {
        command
            .arg("-drive")
            .arg(format!(
                "file={},media=cdrom,readonly=on,format=raw",
                iso.display()
            ))
            .arg("-boot")
            .arg("order=d");
    } else {
        command.arg("-boot").arg("order=c");
    }

    command
        .arg("-nic")
        .arg("none")
        .arg("-vnc")
        .arg(VNC_OPTIONS)
        .arg("-display")
        .arg("none")
        .arg("-monitor")
        .arg("none")
        .arg("-no-reboot")
        .arg("-qmp")
        .arg(qmp)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    let mut child = command.spawn().map_err(|error| {
        VmError::Start(format!("could not run {}: {error}", qemu_path.display()))
    })?;

    drop(log);

    let mut qmp = match wait_for_qmp(&mut child, qmp_path) {
        Ok(client) => client,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(qmp_path);
            return Err(error);
        }
    };

    let console = match configure_console(&mut qmp) {
        Ok(console) => console,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(qmp_path);
            return Err(error);
        }
    };

    Ok(RunningVm {
        child,
        qmp_path: qmp_path.to_path_buf(),
        log_path: log_path.to_path_buf(),
        acceleration: accelerator.to_string(),
        console,
    })
}

fn wait_for_qmp(child: &mut Child, qmp_path: &Path) -> Result<QmpClient, VmError> {
    let deadline = Instant::now() + QMP_START_TIMEOUT;

    loop {
        match QmpClient::connect(qmp_path) {
            Ok(mut client) => {
                let status = client
                    .execute("query-status", None)
                    .map_err(|error| VmError::Start(error.to_string()))?;
                let status = status
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");

                if status == "running" {
                    return Ok(client);
                }

                return Err(VmError::Start(format!(
                    "QEMU started but reported status \"{status}\" instead of running"
                )));
            }
            Err(error) => {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        return Err(VmError::Start(format!(
                            "QEMU exited before QMP became ready with status {status}. {}",
                            log_detail(qmp_path)
                        )));
                    }
                    Ok(None) => {}
                    Err(wait_error) => {
                        return Err(VmError::Process(format!(
                            "could not inspect the QEMU process: {wait_error}"
                        )));
                    }
                }

                if Instant::now() >= deadline {
                    return Err(VmError::Start(format!(
                        "QMP did not become ready within {} seconds: {error}. {}",
                        QMP_START_TIMEOUT.as_secs(),
                        log_detail(qmp_path)
                    )));
                }
            }
        }

        thread::sleep(Duration::from_millis(50));
    }
}

fn configure_console(qmp: &mut QmpClient) -> Result<ConsoleSession, VmError> {
    let password = generate_vnc_password()?;

    qmp.execute(
        "change-vnc-password",
        Some(json!({ "password": &password })),
    )
    .map_err(|error| {
        VmError::Start(format!(
            "QEMU started but the console password could not be set: {error}"
        ))
    })?;

    let servers = qmp.execute("query-vnc-servers", None).map_err(|error| {
        VmError::Start(format!(
            "QEMU started but its console listener could not be inspected: {error}"
        ))
    })?;
    let servers = servers.as_array().ok_or_else(|| {
        VmError::Start("QEMU returned an invalid VNC server description".to_string())
    })?;

    for server in servers {
        let Some(listeners) = server.get("server").and_then(Value::as_array) else {
            continue;
        };

        for listener in listeners {
            if listener.get("websocket").and_then(Value::as_bool) != Some(true) {
                continue;
            }

            let host = listener
                .get("host")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            if host != "127.0.0.1" {
                return Err(VmError::Start(format!(
                    "QEMU exposed the console WebSocket on the non-loopback host \"{host}\""
                )));
            }

            let service = listener
                .get("service")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    VmError::Start(
                        "QEMU did not report a port for the console WebSocket".to_string(),
                    )
                })?;
            let port = service.parse::<u16>().map_err(|_| {
                VmError::Start(format!(
                    "QEMU reported an invalid console WebSocket port \"{service}\""
                ))
            })?;

            if port == 0 {
                return Err(VmError::Start(
                    "QEMU reported port 0 for the console WebSocket".to_string(),
                ));
            }

            return Ok(ConsoleSession {
                ws_url: format!("ws://127.0.0.1:{port}/"),
                password,
            });
        }
    }

    Err(VmError::Start(
        "QEMU did not expose a WebSocket VNC listener; the installed QEMU may lack WebSocket VNC support"
            .to_string(),
    ))
}

fn generate_vnc_password() -> Result<String, VmError> {
    let mut bytes = [0u8; 8];

    #[cfg(unix)]
    {
        let mut random = File::open("/dev/urandom").map_err(|error| {
            VmError::Start(format!(
                "the console password source could not be opened: {error}"
            ))
        })?;
        random.read_exact(&mut bytes).map_err(|error| {
            VmError::Start(format!(
                "the console password could not be generated: {error}"
            ))
        })?;
    }

    #[cfg(not(unix))]
    {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let mut state = nanos ^ (u128::from(std::process::id()) << 64) ^ 0x9e37_79b9_7f4a_7c15;
        for byte in &mut bytes {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *byte = (state & 0xff) as u8;
        }
    }

    let mut password = String::with_capacity(bytes.len());
    for byte in bytes {
        password
            .push(VNC_PASSWORD_ALPHABET[usize::from(byte) % VNC_PASSWORD_ALPHABET.len()] as char);
    }

    Ok(password)
}

pub fn stop(running: &mut RunningVm) -> Result<StopOutcome, VmError> {
    let mut qmp = QmpClient::connect(&running.qmp_path).ok();

    let mut status = if let Some(client) = qmp.as_mut() {
        let _ = client.execute("system_powerdown", None);
        wait_for_exit(&mut running.child, QMP_POWERDOWN_TIMEOUT)?
    } else {
        wait_for_exit(&mut running.child, Duration::from_millis(500))?
    };

    if status.is_none() {
        if let Some(client) = qmp.as_mut() {
            let _ = client.execute("quit", None);
        }
        status = wait_for_exit(&mut running.child, QMP_QUIT_TIMEOUT)?;
    }

    if status.is_none() {
        terminate_process(&running.child);
        status = wait_for_exit(&mut running.child, SIGTERM_TIMEOUT)?;
    }

    if status.is_none() {
        running
            .child
            .kill()
            .map_err(|error| VmError::Stop(format!("could not force QEMU to exit: {error}")))?;
        status = Some(
            running
                .child
                .wait()
                .map_err(|error| VmError::Stop(format!("could not reap QEMU: {error}")))?,
        );
    }

    let _ = fs::remove_file(&running.qmp_path);

    Ok(StopOutcome { status })
}

fn wait_for_exit(child: &mut Child, timeout: Duration) -> Result<Option<ExitStatus>, VmError> {
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(Some(status)),
            Ok(None) if Instant::now() >= deadline => return Ok(None),
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                return Err(VmError::Process(format!(
                    "could not inspect the QEMU process: {error}"
                )));
            }
        }
    }
}

#[cfg(unix)]
fn terminate_process(child: &Child) {
    if let Ok(pid) = i32::try_from(child.id()) {
        // SAFETY: the PID comes from the live child process handle.
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
    }
}

#[cfg(not(unix))]
fn terminate_process(child: &Child) {
    let _ = child.kill();
}

fn validate_qemu_path(path: &Path, label: &str) -> Result<(), VmError> {
    let value = path.to_string_lossy();
    if value.contains(',') || value.contains('\n') || value.contains('\r') {
        return Err(VmError::Start(format!(
            "the {label} contains a character QEMU option parsing cannot safely accept: {}",
            path.display()
        )));
    }
    Ok(())
}

fn log_detail(qmp_path: &Path) -> String {
    let Some(vm_dir) = qmp_path.parent() else {
        return "No QEMU log is available.".to_string();
    };
    let log_path = vm_dir.join("qemu.log");
    let detail = read_log_tail(&log_path);

    if detail.is_empty() {
        format!("No QEMU log output was captured at {}.", log_path.display())
    } else {
        format!("QEMU log ({}): {}", log_path.display(), detail)
    }
}

fn read_log_tail(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else {
        return String::new();
    };
    let Ok(metadata) = file.metadata() else {
        return String::new();
    };
    let start = metadata.len().saturating_sub(LOG_TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return String::new();
    }

    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }

    let value = String::from_utf8_lossy(&bytes);
    let value = value.trim();
    value.chars().take(4_000).collect()
}
