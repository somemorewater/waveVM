use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::qmp::{QmpClient, QmpMonitor};

use super::log::{LogComponent, LogOutcome, LogSeverity, LogSource, SessionLog};
use super::{NetworkAdapter, NetworkConfig, NetworkMode, VmConfig, VmError};

const QMP_START_TIMEOUT: Duration = Duration::from_secs(5);
const QMP_POWERDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const QMP_QUIT_TIMEOUT: Duration = Duration::from_secs(3);
const SIGTERM_TIMEOUT: Duration = Duration::from_secs(2);
const LOG_TAIL_BYTES: u64 = 16 * 1024;
const VNC_OPTIONS: &str = "127.0.0.1:0,to=99,websocket=on,password=on";
const VNC_PASSWORD_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const NETDEV_ID: &str = "net0";
const VIRTIO_NET_DEVICE: &str = "virtio-net-pci";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSession {
    pub ws_url: String,
    pub password: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    User,
    ApplicationShutdown,
    StartupFailure,
}

impl StopReason {
    fn description(self) -> &'static str {
        match self {
            Self::User => "the user requested it",
            Self::ApplicationShutdown => "Wave VM is shutting down",
            Self::StartupFailure => "a startup failure required cleanup",
        }
    }

    fn outcome(self) -> LogOutcome {
        match self {
            Self::User => LogOutcome::StoppedByUser,
            Self::ApplicationShutdown => LogOutcome::ApplicationShutdown,
            Self::StartupFailure => LogOutcome::StartupFailure,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Termination {
    pub outcome: LogOutcome,
    pub severity: LogSeverity,
    pub summary: String,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
}

impl Termination {
    pub fn is_failure(&self) -> bool {
        self.outcome.is_failure()
    }
}

pub struct StopOutcome {
    pub termination: Termination,
}

pub struct RunningVm {
    pub child: Child,
    pub qmp_path: PathBuf,
    pub acceleration: String,
    pub console: ConsoleSession,
    log: Arc<SessionLog>,
    signals: Arc<QmpSignals>,
    monitor_stop: Arc<AtomicBool>,
    monitor: Option<JoinHandle<()>>,
    stdout_reader: Option<JoinHandle<()>>,
    stderr_reader: Option<JoinHandle<()>>,
}

impl RunningVm {
    pub fn log_session_id(&self) -> &str {
        self.log.session_id()
    }

    pub fn record(&self, severity: LogSeverity, component: LogComponent, message: &str) {
        self.log
            .log(severity, component, LogSource::Application, message);
    }

    pub fn finish_unexpected(&mut self, status: ExitStatus) -> Termination {
        self.collect_output();
        self.stop_monitor();

        if let Some(last) = self.log.last_raw_line() {
            self.log.info(
                LogComponent::Qemu,
                LogSource::Application,
                &format!("Last QEMU output before exit: {last}"),
            );
        }

        let termination = classify_unexpected(&status, &self.signals);
        self.log.finish(
            termination.outcome,
            termination.severity,
            &termination.summary,
            termination.exit_code,
            termination.signal,
        );
        let _ = fs::remove_file(&self.qmp_path);

        termination
    }

    fn collect_output(&mut self) {
        if let Some(handle) = self.stdout_reader.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.stderr_reader.take() {
            let _ = handle.join();
        }
    }

    fn stop_monitor(&mut self) {
        self.monitor_stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.monitor.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Default)]
struct QmpSignals {
    shutdown_reason: Mutex<Option<String>>,
    guest_panicked: AtomicBool,
    panic_detail: Mutex<Option<String>>,
}

impl QmpSignals {
    fn record_shutdown(&self, reason: &str) {
        *lock_unpoisoned(&self.shutdown_reason) = Some(reason.to_string());
    }

    fn record_panic(&self, detail: &str) {
        self.guest_panicked.store(true, Ordering::SeqCst);
        *lock_unpoisoned(&self.panic_detail) = Some(detail.to_string());
    }

    fn shutdown_reason(&self) -> Option<String> {
        lock_unpoisoned(&self.shutdown_reason).clone()
    }

    fn guest_panicked(&self) -> bool {
        self.guest_panicked.load(Ordering::SeqCst)
    }

    fn panic_detail(&self) -> Option<String> {
        lock_unpoisoned(&self.panic_detail).clone()
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct ProcessExit {
    code: Option<i32>,
    signal: Option<i32>,
}

impl ProcessExit {
    fn from_status(status: &ExitStatus) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            Self {
                code: status.code(),
                signal: status.signal(),
            }
        }

        #[cfg(not(unix))]
        {
            Self {
                code: status.code(),
                signal: None,
            }
        }
    }

    fn describe(self) -> String {
        match (self.code, self.signal) {
            (_, Some(signal)) => format!("terminated by signal {signal}"),
            (Some(code), None) => format!("exited with code {code}"),
            (None, None) => "exited with an unknown status".to_string(),
        }
    }
}

pub fn launch(
    vm: &VmConfig,
    qemu_path: &Path,
    qemu_version: Option<&str>,
    disk_path: &Path,
    kvm_usable: bool,
    install_iso: Option<&Path>,
) -> Result<RunningVm, VmError> {
    let vm_dir = disk_path.parent().ok_or_else(|| {
        VmError::Start("the virtual disk path has no parent directory".to_string())
    })?;
    let qmp_path = vm_dir.join("qmp.sock");
    let logs_dir = vm_dir.join("logs");

    let log = Arc::new(SessionLog::create(vm, &logs_dir).map_err(|error| {
        VmError::Start(format!(
            "the diagnostic log in {} could not be created: {error}",
            logs_dir.display()
        ))
    })?);

    record_startup_context(
        &log,
        vm,
        qemu_path,
        qemu_version,
        disk_path,
        kvm_usable,
        install_iso,
    );

    let result = launch_with_log(
        vm,
        qemu_path,
        disk_path,
        &qmp_path,
        &log,
        kvm_usable,
        install_iso,
    );

    if let Err(error) = &result {
        if vm.network.enabled {
            log.error(
                LogComponent::Network,
                LogSource::Application,
                &format!("Network startup failed: {error}"),
            );
        }
        log.error(
            LogComponent::Vm,
            LogSource::Application,
            &format!("Startup failed: {error}"),
        );
        log.finish(
            LogOutcome::StartupFailure,
            LogSeverity::Error,
            &error.to_string(),
            None,
            None,
        );
    }

    result
}

fn record_startup_context(
    log: &SessionLog,
    vm: &VmConfig,
    qemu_path: &Path,
    qemu_version: Option<&str>,
    disk_path: &Path,
    kvm_usable: bool,
    install_iso: Option<&Path>,
) {
    log.info(
        LogComponent::Vm,
        LogSource::Application,
        &format!("Starting virtual machine \"{}\" ({})", vm.name, vm.id),
    );
    log.info(
        LogComponent::Vm,
        LogSource::Application,
        &format!("Guest architecture: {}", vm.guest_arch),
    );
    log.info(
        LogComponent::Vm,
        LogSource::Application,
        &format!("Memory: {} MiB", vm.memory_mib),
    );
    log.info(
        LogComponent::Vm,
        LogSource::Application,
        &format!("Virtual CPUs: {}", vm.vcpus),
    );
    log.info(
        LogComponent::Host,
        LogSource::Application,
        &format!(
            "Host platform: {} {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );
    log.info(
        LogComponent::Qemu,
        LogSource::Application,
        &format!(
            "QEMU executable: {} ({})",
            qemu_path.display(),
            qemu_version.unwrap_or("version unavailable")
        ),
    );
    log.info(
        LogComponent::Vm,
        LogSource::Application,
        &format!(
            "Accelerator preference: {}",
            if kvm_usable {
                "KVM with TCG fallback"
            } else {
                "TCG software emulation"
            }
        ),
    );
    log.info(
        LogComponent::Storage,
        LogSource::Application,
        &format!("Virtual disk: {} (qcow2, virtio)", disk_path.display()),
    );

    match install_iso {
        Some(iso) => log.info(
            LogComponent::Boot,
            LogSource::Application,
            &format!(
                "Installation ISO: {} (read-only CD-ROM, boot order=cdrom)",
                iso.display()
            ),
        ),
        None => log.info(
            LogComponent::Boot,
            LogSource::Application,
            "Boot: virtual disk (boot order=disk)",
        ),
    }

    if vm.network.enabled {
        log.info(
            LogComponent::Network,
            LogSource::Application,
            &format!(
                "Network: {} mode with a {} virtual adapter. QEMU provides DHCP and DNS forwarding for outbound access; guest connectivity is not verified at startup.",
                vm.network.mode.label(),
                vm.network.adapter.label()
            ),
        );
    } else {
        log.info(
            LogComponent::Network,
            LogSource::Application,
            "Network: disabled; no virtual network device will be attached.",
        );
    }
    log.info(
        LogComponent::Firmware,
        LogSource::Application,
        "Firmware: QEMU default firmware; no explicit firmware image is configured.",
    );
    log.info(
        LogComponent::Console,
        LogSource::Application,
        "Console: VNC bound to 127.0.0.1 with a per-session password.",
    );
}

fn launch_with_log(
    vm: &VmConfig,
    qemu_path: &Path,
    disk_path: &Path,
    qmp_path: &Path,
    log: &Arc<SessionLog>,
    kvm_usable: bool,
    install_iso: Option<&Path>,
) -> Result<RunningVm, VmError> {
    validate_qemu_path(disk_path, "virtual disk path")?;
    validate_qemu_path(qmp_path, "QMP socket path")?;

    #[cfg(unix)]
    if qmp_path.to_string_lossy().len() > 100 {
        return Err(VmError::Start(format!(
            "the QMP socket path is too long for a Unix socket: {}",
            qmp_path.display()
        )));
    }

    if let Some(iso) = install_iso {
        validate_qemu_path(iso, "installation ISO path")?;
    }

    if qmp_path.exists() {
        if QmpClient::connect(qmp_path).is_ok() {
            return Err(VmError::Busy {
                id: vm.id.clone(),
                message: "a live QMP endpoint already exists for this machine; another QEMU process may still be running".to_string(),
            });
        }
    }

    match fs::remove_file(qmp_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(VmError::Start(format!(
                "the stale QMP socket {} could not be removed: {error}",
                qmp_path.display()
            )));
        }
    }

    if vm.network.enabled {
        ensure_user_networking_supported(qemu_path, log)?;
    }
    let network_args = build_network_arguments(&vm.network)?;

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
            qmp_path,
            accelerator,
            install_iso,
            &network_args,
            log,
        ) {
            Ok(running) => return Ok(running),
            Err(error) => {
                if *accelerator == "kvm" && index + 1 < accelerators.len() {
                    log.warn(
                        LogComponent::Qemu,
                        LogSource::Application,
                        &format!("The KVM attempt failed; retrying with TCG: {error}"),
                    );
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
    accelerator: &str,
    install_iso: Option<&Path>,
    network_args: &[String],
    log: &Arc<SessionLog>,
) -> Result<RunningVm, VmError> {
    let mut arguments = vec![
        "-name".to_string(),
        format!("wave-vm-{}", vm.id),
        "-machine".to_string(),
        "q35".to_string(),
        "-accel".to_string(),
        accelerator.to_string(),
        "-m".to_string(),
        format!("{}M", vm.memory_mib),
        "-smp".to_string(),
        vm.vcpus.to_string(),
        "-drive".to_string(),
        format!("file={},if=virtio,format=qcow2", disk_path.display()),
    ];

    if let Some(iso) = install_iso {
        arguments.extend([
            "-drive".to_string(),
            format!("file={},media=cdrom,readonly=on,format=raw", iso.display()),
            "-boot".to_string(),
            "order=d".to_string(),
        ]);
    } else {
        arguments.extend(["-boot".to_string(), "order=c".to_string()]);
    }

    arguments.extend_from_slice(network_args);
    arguments.extend([
        "-vnc".to_string(),
        VNC_OPTIONS.to_string(),
        "-display".to_string(),
        "none".to_string(),
        "-monitor".to_string(),
        "none".to_string(),
        "-no-reboot".to_string(),
        "-qmp".to_string(),
        format!("unix:{},server=on,wait=off", qmp_path.display()),
    ]);

    log.info(
        LogComponent::Qemu,
        LogSource::Application,
        &format!("Launching QEMU with accelerator {accelerator}"),
    );
    log.info(
        LogComponent::Qemu,
        LogSource::Application,
        &format!("QEMU arguments: {}", redact_arguments(&arguments)),
    );

    let mut command = Command::new(qemu_path);
    command
        .args(&arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let message = format!("could not run {}: {error}", qemu_path.display());
            log.error(
                LogComponent::Qemu,
                LogSource::Application,
                &format!("Failed to start QEMU: {message}"),
            );
            return Err(VmError::Start(message));
        }
    };

    log.info(
        LogComponent::Qemu,
        LogSource::Application,
        &format!("QEMU process started (pid {})", child.id()),
    );

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| VmError::Start("QEMU stdout could not be captured".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| VmError::Start("QEMU stderr could not be captured".to_string()))?;

    let stdout_reader = spawn_output_reader(
        stdout,
        log.clone(),
        LogSource::QemuStdout,
        vm.network.enabled,
    );
    let stderr_reader = spawn_output_reader(
        stderr,
        log.clone(),
        LogSource::QemuStderr,
        vm.network.enabled,
    );
    let signals = Arc::new(QmpSignals::default());

    let mut qmp = match wait_for_qmp(&mut child, qmp_path, log, &signals) {
        Ok(client) => client,
        Err(error) => {
            log.error(
                LogComponent::Qmp,
                LogSource::Application,
                &format!("QMP startup failed: {error}"),
            );
            let _ = child.kill();
            let _ = child.wait();
            join_reader(stdout_reader);
            join_reader(stderr_reader);
            let _ = fs::remove_file(qmp_path);
            return Err(error);
        }
    };

    let (monitor_stop, monitor) =
        start_qmp_monitor(log.clone(), qmp_path.to_path_buf(), signals.clone());

    let console = match configure_console(&mut qmp, log, &signals) {
        Ok(console) => console,
        Err(error) => {
            log.error(
                LogComponent::Console,
                LogSource::Application,
                &format!("Console initialization failed: {error}"),
            );
            let _ = child.kill();
            let _ = child.wait();
            monitor_stop.store(true, Ordering::SeqCst);
            if let Some(handle) = monitor {
                let _ = handle.join();
            }
            join_reader(stdout_reader);
            join_reader(stderr_reader);
            let _ = fs::remove_file(qmp_path);
            return Err(error);
        }
    };

    if vm.network.enabled {
        log.info(
            LogComponent::Network,
            LogSource::Application,
            "QEMU initialized the NAT network backend and virtual Ethernet adapter (host-side). Guest IP configuration and internet access are not verified.",
        );
    }

    log.info(
        LogComponent::Vm,
        LogSource::Application,
        "Virtual machine is running.",
    );

    Ok(RunningVm {
        child,
        qmp_path: qmp_path.to_path_buf(),
        acceleration: accelerator.to_string(),
        console,
        log: log.clone(),
        signals,
        monitor_stop,
        monitor,
        stdout_reader: Some(stdout_reader),
        stderr_reader: Some(stderr_reader),
    })
}

fn ensure_user_networking_supported(qemu_path: &Path, log: &SessionLog) -> Result<(), VmError> {
    let output = Command::new(qemu_path)
        .arg("-netdev")
        .arg("help")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| {
            let message = format!("could not query QEMU networking support: {error}");
            log.error(LogComponent::Network, LogSource::Application, &message);
            VmError::QemuUnavailable(message)
        })?;

    let mut listing = String::from_utf8_lossy(&output.stdout).into_owned();
    listing.push_str(&String::from_utf8_lossy(&output.stderr));

    if listing.lines().any(|line| line.trim() == "user") {
        log.info(
            LogComponent::Network,
            LogSource::Application,
            "QEMU reports support for user-mode (SLIRP) networking.",
        );
        return Ok(());
    }

    let message = "the installed QEMU does not provide user-mode networking (-netdev user), so NAT networking cannot start; install a QEMU build with SLIRP support or disable networking for this machine".to_string();
    log.error(LogComponent::Network, LogSource::Application, &message);
    Err(VmError::QemuUnavailable(message))
}

fn build_network_arguments(network: &NetworkConfig) -> Result<Vec<String>, VmError> {
    // `-nic none` suppresses QEMU's automatic default NIC. When networking is
    // enabled, the explicit user-mode netdev and VirtIO device below are still
    // attached, so exactly one adapter exists.
    if !network.enabled {
        return Ok(vec!["-nic".to_string(), "none".to_string()]);
    }

    if network.mode != NetworkMode::Nat {
        return Err(VmError::Unsupported(format!(
            "the {} network mode is planned but not implemented; only NAT is available",
            network.mode.label()
        )));
    }

    let device = match network.adapter {
        NetworkAdapter::Virtio => VIRTIO_NET_DEVICE,
    };

    Ok(vec![
        "-nic".to_string(),
        "none".to_string(),
        "-netdev".to_string(),
        format!("user,id={NETDEV_ID}"),
        "-device".to_string(),
        format!("{device},netdev={NETDEV_ID}"),
    ])
}

fn mentions_network(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    ["netdev", "network", "slirp", "virtio-net", "user-mode"]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn spawn_output_reader<R: Read + Send + 'static>(
    stream: R,
    log: Arc<SessionLog>,
    source: LogSource,
    network_enabled: bool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let reader = BufReader::new(stream);

        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if network_enabled && source == LogSource::QemuStderr && mentions_network(&line)
                    {
                        log.warn(
                            LogComponent::Network,
                            LogSource::QemuStderr,
                            &format!("QEMU network message: {line}"),
                        );
                    }
                    log.qemu_line(source, &line);
                }
                Err(error) => {
                    log.warn(
                        LogComponent::Qemu,
                        LogSource::Application,
                        &format!("Could not read QEMU output: {error}"),
                    );
                    break;
                }
            }
        }
    })
}

fn join_reader(handle: JoinHandle<()>) {
    let _ = handle.join();
}

fn wait_for_qmp(
    child: &mut Child,
    qmp_path: &Path,
    log: &SessionLog,
    signals: &QmpSignals,
) -> Result<QmpClient, VmError> {
    let deadline = Instant::now() + QMP_START_TIMEOUT;
    let mut last_error: Option<String>;

    loop {
        match QmpClient::connect(qmp_path) {
            Ok(mut client) => {
                log.info(
                    LogComponent::Qmp,
                    LogSource::Application,
                    "QMP connection established.",
                );

                let status = match client.execute("query-status", None) {
                    Ok(status) => status,
                    Err(error) => {
                        log.error(
                            LogComponent::Qmp,
                            LogSource::Application,
                            &format!("QMP query-status failed: {error}"),
                        );
                        return Err(VmError::Start(format!(
                            "QEMU started but its status could not be queried: {error}"
                        )));
                    }
                };
                drain_qmp_events(&mut client, log, signals);

                let status = status
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                log.info(
                    LogComponent::Qmp,
                    LogSource::Application,
                    &format!("QEMU reported status \"{status}\"."),
                );

                if status == "running" {
                    return Ok(client);
                }

                return Err(VmError::Start(format!(
                    "QEMU started but reported status \"{status}\" instead of running"
                )));
            }
            Err(error) => {
                last_error = Some(error.to_string());

                match child.try_wait() {
                    Ok(Some(status)) => {
                        let exit = ProcessExit::from_status(&status);
                        log.error(
                            LogComponent::Qemu,
                            LogSource::Application,
                            &format!("QEMU exited before QMP became ready: {}.", exit.describe()),
                        );
                        return Err(VmError::Start(format!(
                            "QEMU exited before QMP became ready: {}. {}",
                            exit.describe(),
                            log_detail(log.log_path())
                        )));
                    }
                    Ok(None) => {}
                    Err(wait_error) => {
                        log.error(
                            LogComponent::Vm,
                            LogSource::Application,
                            &format!("Could not inspect the QEMU process: {wait_error}"),
                        );
                        return Err(VmError::Process(format!(
                            "could not inspect the QEMU process: {wait_error}"
                        )));
                    }
                }

                if Instant::now() >= deadline {
                    let detail = last_error.as_deref().unwrap_or("unknown QMP error");
                    log.error(
                        LogComponent::Qmp,
                        LogSource::Application,
                        &format!(
                            "QMP did not become ready within {} seconds: {detail}",
                            QMP_START_TIMEOUT.as_secs()
                        ),
                    );
                    return Err(VmError::Start(format!(
                        "QMP did not become ready within {} seconds: {detail}. {}",
                        QMP_START_TIMEOUT.as_secs(),
                        log_detail(log.log_path())
                    )));
                }
            }
        }

        thread::sleep(Duration::from_millis(50));
    }
}

fn configure_console(
    qmp: &mut QmpClient,
    log: &SessionLog,
    signals: &QmpSignals,
) -> Result<ConsoleSession, VmError> {
    let password = generate_vnc_password()?;

    log.info(
        LogComponent::Console,
        LogSource::Application,
        "Configuring the VNC console password.",
    );

    match qmp.execute(
        "change-vnc-password",
        Some(json!({ "password": &password })),
    ) {
        Ok(_) => log.info(
            LogComponent::Console,
            LogSource::Application,
            "Console password configured.",
        ),
        Err(error) => {
            log.error(
                LogComponent::Console,
                LogSource::Application,
                &format!("The console password could not be set: {error}"),
            );
            return Err(VmError::Start(format!(
                "QEMU started but the console password could not be set: {error}"
            )));
        }
    }
    drain_qmp_events(qmp, log, signals);

    let servers = match qmp.execute("query-vnc-servers", None) {
        Ok(servers) => servers,
        Err(error) => {
            log.error(
                LogComponent::Console,
                LogSource::Application,
                &format!("The console listener could not be inspected: {error}"),
            );
            return Err(VmError::Start(format!(
                "QEMU started but its console listener could not be inspected: {error}"
            )));
        }
    };
    drain_qmp_events(qmp, log, signals);

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
                log.error(
                    LogComponent::Console,
                    LogSource::Application,
                    &format!(
                        "QEMU exposed the console WebSocket on the non-loopback host \"{host}\"."
                    ),
                );
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

            log.info(
                LogComponent::Console,
                LogSource::Application,
                &format!("Console WebSocket listening on 127.0.0.1:{port}."),
            );

            return Ok(ConsoleSession {
                ws_url: format!("ws://127.0.0.1:{port}/"),
                password,
            });
        }
    }

    log.error(
        LogComponent::Console,
        LogSource::Application,
        "QEMU did not expose a WebSocket VNC listener.",
    );
    Err(VmError::Start(
        "QEMU did not expose a WebSocket VNC listener; the installed QEMU may lack WebSocket VNC support"
            .to_string(),
    ))
}

fn start_qmp_monitor(
    log: Arc<SessionLog>,
    qmp_path: PathBuf,
    signals: Arc<QmpSignals>,
) -> (Arc<AtomicBool>, Option<JoinHandle<()>>) {
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();

    let handle = thread::spawn(move || {
        let mut monitor = match QmpMonitor::connect(&qmp_path) {
            Ok(monitor) => {
                log.info(
                    LogComponent::Qmp,
                    LogSource::Application,
                    "QMP event monitor connected.",
                );
                monitor
            }
            Err(error) => {
                log.warn(
                    LogComponent::Qmp,
                    LogSource::Application,
                    &format!(
                        "QMP event monitor could not connect; QMP events will not be recorded: {error}"
                    ),
                );
                return;
            }
        };

        loop {
            if thread_stop.load(Ordering::SeqCst) {
                break;
            }

            match monitor.next_event() {
                Ok(Some(event)) => handle_qmp_event(&log, &signals, &event),
                Ok(None) => {}
                Err(error) => {
                    if !thread_stop.load(Ordering::SeqCst) {
                        log.warn(
                            LogComponent::Qmp,
                            LogSource::Application,
                            &format!("QMP event monitor disconnected: {error}"),
                        );
                    }
                    break;
                }
            }
        }
    });

    (stop, Some(handle))
}

fn drain_qmp_events(client: &mut QmpClient, log: &SessionLog, signals: &QmpSignals) {
    for event in client.take_events() {
        handle_qmp_event(log, signals, &event);
    }
}

fn handle_qmp_event(log: &SessionLog, signals: &QmpSignals, event: &Value) {
    let name = event
        .get("event")
        .and_then(Value::as_str)
        .unwrap_or("UNKNOWN");
    let data = event.get("data").cloned().unwrap_or(Value::Null);
    let data_text = if data.is_null() {
        String::new()
    } else {
        serde_json::to_string(&data).unwrap_or_default()
    };

    match name {
        "SHUTDOWN" => {
            let reason = data
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            signals.record_shutdown(reason);
            log.info(
                LogComponent::Qmp,
                LogSource::QmpEvent,
                &format!("QMP event SHUTDOWN (reason: {reason})."),
            );
        }
        "GUEST_PANICKED" => {
            let detail = if data_text.is_empty() {
                "no additional detail".to_string()
            } else {
                data_text.clone()
            };
            signals.record_panic(&detail);
            log.error(
                LogComponent::Qmp,
                LogSource::QmpEvent,
                &format!(
                    "QMP event GUEST_PANICKED: the guest operating system reported a panic ({detail})."
                ),
            );
        }
        "WATCHDOG" => log.warn(
            LogComponent::Qmp,
            LogSource::QmpEvent,
            &format!("QMP event WATCHDOG: {data_text}"),
        ),
        "BLOCK_IO_ERROR" => log.error(
            LogComponent::Qmp,
            LogSource::QmpEvent,
            &format!("QMP event BLOCK_IO_ERROR: {data_text}"),
        ),
        "POWERDOWN" => log.info(
            LogComponent::Qmp,
            LogSource::QmpEvent,
            "QMP event POWERDOWN: the guest requested a power-down.",
        ),
        "RESET" => log.info(
            LogComponent::Qmp,
            LogSource::QmpEvent,
            &format!("QMP event RESET: {data_text}"),
        ),
        "STOP" => log.info(
            LogComponent::Qmp,
            LogSource::QmpEvent,
            &format!("QMP event STOP: {data_text}"),
        ),
        "RESUME" => log.info(
            LogComponent::Qmp,
            LogSource::QmpEvent,
            "QMP event RESUME: the guest resumed.",
        ),
        _ => log.debug(
            LogComponent::Qmp,
            LogSource::QmpEvent,
            &format!("QMP event {name}: {data_text}"),
        ),
    }
}

fn classify_unexpected(status: &ExitStatus, signals: &QmpSignals) -> Termination {
    let exit = ProcessExit::from_status(status);

    if signals.guest_panicked() {
        let detail = signals
            .panic_detail()
            .unwrap_or_else(|| "no additional detail".to_string());
        return Termination {
            outcome: LogOutcome::GuestPanic,
            severity: LogSeverity::Error,
            summary: format!(
                "The guest operating system reported a panic ({detail}). QEMU {}.",
                exit.describe()
            ),
            exit_code: exit.code,
            signal: exit.signal,
        };
    }

    if let Some(reason) = signals.shutdown_reason() {
        if reason == "guest-shutdown" {
            if exit.code == Some(0) && exit.signal.is_none() {
                return Termination {
                    outcome: LogOutcome::GuestShutdown,
                    severity: LogSeverity::Info,
                    summary: format!(
                        "The guest operating system shut down normally. QEMU {}.",
                        exit.describe()
                    ),
                    exit_code: exit.code,
                    signal: exit.signal,
                };
            }

            return Termination {
                outcome: LogOutcome::ProcessFailure,
                severity: LogSeverity::Error,
                summary: format!(
                    "The guest requested a shutdown, but QEMU exited abnormally: it {}.",
                    exit.describe()
                ),
                exit_code: exit.code,
                signal: exit.signal,
            };
        }

        if reason == "host-signal" {
            return Termination {
                outcome: LogOutcome::ProcessFailure,
                severity: LogSeverity::Error,
                summary: format!(
                    "QEMU received a host signal and {}. This was not a guest shutdown request.",
                    exit.describe()
                ),
                exit_code: exit.code,
                signal: exit.signal,
            };
        }

        return Termination {
            outcome: LogOutcome::UnexpectedExit,
            severity: LogSeverity::Warn,
            summary: format!(
                "QEMU shut down without a user stop request (reason: {reason}). It {}.",
                exit.describe()
            ),
            exit_code: exit.code,
            signal: exit.signal,
        };
    }

    if exit.code == Some(0) && exit.signal.is_none() {
        return Termination {
            outcome: LogOutcome::UnexpectedExit,
            severity: LogSeverity::Warn,
            summary: format!(
                "QEMU {} without a recorded guest shutdown or user stop request.",
                exit.describe()
            ),
            exit_code: exit.code,
            signal: exit.signal,
        };
    }

    Termination {
        outcome: LogOutcome::ProcessFailure,
        severity: LogSeverity::Error,
        summary: format!("QEMU exited unexpectedly: it {}.", exit.describe()),
        exit_code: exit.code,
        signal: exit.signal,
    }
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

pub fn stop(running: &mut RunningVm, reason: StopReason) -> Result<StopOutcome, VmError> {
    running.log.info(
        LogComponent::Vm,
        LogSource::Application,
        &format!(
            "Stopping the virtual machine because {}.",
            reason.description()
        ),
    );

    let mut qmp = match QmpClient::connect(&running.qmp_path) {
        Ok(client) => {
            running.log.info(
                LogComponent::Qmp,
                LogSource::Application,
                "QMP connection established for shutdown.",
            );
            Some(client)
        }
        Err(error) => {
            running.log.warn(
                LogComponent::Qmp,
                LogSource::Application,
                &format!("QMP is unavailable for shutdown: {error}"),
            );
            None
        }
    };

    let mut forced = false;
    let mut status = if let Some(client) = qmp.as_mut() {
        match client.execute("system_powerdown", None) {
            Ok(_) => running.log.info(
                LogComponent::Qmp,
                LogSource::Application,
                "Requested a guest power-down through QMP.",
            ),
            Err(error) => running.log.warn(
                LogComponent::Qmp,
                LogSource::Application,
                &format!("The system_powerdown request failed: {error}"),
            ),
        }
        drain_qmp_events(client, &running.log, &running.signals);
        wait_for_exit(&mut running.child, QMP_POWERDOWN_TIMEOUT)?
    } else {
        wait_for_exit(&mut running.child, Duration::from_millis(500))?
    };

    if status.is_none() {
        if let Some(client) = qmp.as_mut() {
            match client.execute("quit", None) {
                Ok(_) => running.log.info(
                    LogComponent::Qmp,
                    LogSource::Application,
                    "Requested QEMU quit through QMP.",
                ),
                Err(error) => running.log.warn(
                    LogComponent::Qmp,
                    LogSource::Application,
                    &format!("The quit request failed: {error}"),
                ),
            }
        }
        status = wait_for_exit(&mut running.child, QMP_QUIT_TIMEOUT)?;
    }

    if status.is_none() {
        forced = true;
        running.log.warn(
            LogComponent::Qemu,
            LogSource::Application,
            "QEMU did not stop within the grace period; sending SIGTERM.",
        );
        terminate_process(&running.child);
        status = wait_for_exit(&mut running.child, SIGTERM_TIMEOUT)?;
    }

    if status.is_none() {
        forced = true;
        running.log.warn(
            LogComponent::Qemu,
            LogSource::Application,
            "QEMU did not respond to SIGTERM; force-killing the process.",
        );
        running.child.kill().map_err(|error| {
            running.log.error(
                LogComponent::Qemu,
                LogSource::Application,
                &format!("Could not force QEMU to exit: {error}"),
            );
            VmError::Stop(format!("could not force QEMU to exit: {error}"))
        })?;
        status = Some(running.child.wait().map_err(|error| {
            running.log.error(
                LogComponent::Qemu,
                LogSource::Application,
                &format!("Could not reap the QEMU process: {error}"),
            );
            VmError::Stop(format!("could not reap QEMU: {error}"))
        })?);
    }

    let status = status.expect("a process status exists after the shutdown sequence");
    running.collect_output();
    running.stop_monitor();

    if let Some(last) = running.log.last_raw_line() {
        running.log.info(
            LogComponent::Qemu,
            LogSource::Application,
            &format!("Last QEMU output before exit: {last}"),
        );
    }

    let exit = ProcessExit::from_status(&status);
    let outcome = reason.outcome();
    let severity = if forced || !status.success() {
        LogSeverity::Warn
    } else {
        LogSeverity::Info
    };
    let summary = if forced {
        format!(
            "QEMU was stopped because {}; it did not stop within the grace period and was terminated ({}).",
            reason.description(),
            exit.describe()
        )
    } else {
        format!(
            "QEMU was stopped because {}; it {}.",
            reason.description(),
            exit.describe()
        )
    };

    running
        .log
        .finish(outcome, severity, &summary, exit.code, exit.signal);
    let _ = fs::remove_file(&running.qmp_path);

    Ok(StopOutcome {
        termination: Termination {
            outcome,
            severity,
            summary,
            exit_code: exit.code,
            signal: exit.signal,
        },
    })
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

fn redact_arguments(arguments: &[String]) -> String {
    arguments
        .iter()
        .map(|argument| redact_argument(argument))
        .collect::<Vec<_>>()
        .join(" ")
}

fn redact_argument(argument: &str) -> String {
    let lower = argument.to_ascii_lowercase();

    for key in ["password=", "secret=", "token="] {
        let Some(index) = lower.find(key) else {
            continue;
        };

        let value_start = index + key.len();
        let value = &argument[value_start..];
        let trimmed = value.trim_matches(|character: char| {
            character == '"' || character == '\'' || character == ',' || character.is_whitespace()
        });

        if trimmed.eq_ignore_ascii_case("on") || trimmed.eq_ignore_ascii_case("off") {
            return argument.to_string();
        }

        let mut redacted = String::new();
        redacted.push_str(&argument[..value_start]);
        redacted.push_str("<redacted>");
        return redacted;
    }

    argument.to_string()
}

fn log_detail(log_path: &Path) -> String {
    let detail = read_log_tail(log_path);

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

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
