use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::VmConfig;

const MAX_RAW_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 16 * 1024;
const MAX_SESSIONS: usize = 20;

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSeverity {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogSeverity {
    fn label(self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "DEBUG" => Some(Self::Debug),
            "INFO" => Some(Self::Info),
            "WARN" => Some(Self::Warn),
            "ERROR" => Some(Self::Error),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogComponent {
    Qemu,
    Qmp,
    Vm,
    Console,
    Storage,
    Network,
    Firmware,
    Boot,
    Host,
}

impl LogComponent {
    fn label(self) -> &'static str {
        match self {
            Self::Qemu => "QEMU",
            Self::Qmp => "QMP",
            Self::Vm => "VM",
            Self::Console => "CONSOLE",
            Self::Storage => "STORAGE",
            Self::Network => "NETWORK",
            Self::Firmware => "FIRMWARE",
            Self::Boot => "BOOT",
            Self::Host => "HOST",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "QEMU" => Some(Self::Qemu),
            "QMP" => Some(Self::Qmp),
            "VM" => Some(Self::Vm),
            "CONSOLE" => Some(Self::Console),
            "STORAGE" => Some(Self::Storage),
            "NETWORK" => Some(Self::Network),
            "FIRMWARE" => Some(Self::Firmware),
            "BOOT" => Some(Self::Boot),
            "HOST" => Some(Self::Host),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSource {
    Application,
    QemuStdout,
    QemuStderr,
    QmpEvent,
}

impl LogSource {
    fn label(self) -> &'static str {
        match self {
            Self::Application => "APP",
            Self::QemuStdout => "STDOUT",
            Self::QemuStderr => "STDERR",
            Self::QmpEvent => "QMP-EVENT",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "APP" => Some(Self::Application),
            "STDOUT" => Some(Self::QemuStdout),
            "STDERR" => Some(Self::QemuStderr),
            "QMP-EVENT" => Some(Self::QmpEvent),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogOutcome {
    Running,
    StoppedByUser,
    GuestShutdown,
    ProcessFailure,
    UnexpectedExit,
    StartupFailure,
    ApplicationShutdown,
    GuestPanic,
}

impl LogOutcome {
    pub fn is_failure(self) -> bool {
        matches!(
            self,
            Self::ProcessFailure | Self::UnexpectedExit | Self::StartupFailure | Self::GuestPanic
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp_ms: u64,
    pub severity: LogSeverity,
    pub component: LogComponent,
    pub source: LogSource,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSessionInfo {
    pub session_id: String,
    pub started_at_unix_ms: u64,
    pub ended_at_unix_ms: Option<u64>,
    pub outcome: LogOutcome,
    pub summary: Option<String>,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub log_path: String,
    pub size_bytes: u64,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VmLogView {
    pub vm_id: String,
    pub log_directory: String,
    pub sessions: Vec<LogSessionInfo>,
    pub selected_session_id: Option<String>,
    pub entries: Vec<LogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMeta {
    session_id: String,
    vm_id: String,
    started_at_unix_ms: u64,
    ended_at_unix_ms: Option<u64>,
    outcome: LogOutcome,
    summary: Option<String>,
    exit_code: Option<i32>,
    signal: Option<i32>,
}

struct LogFile {
    file: File,
    total_bytes: u64,
    raw_bytes: u64,
    raw_suppressed: bool,
}

pub struct SessionLog {
    session_id: String,
    vm_id: String,
    started_at_unix_ms: u64,
    log_path: PathBuf,
    meta_path: PathBuf,
    file: Mutex<LogFile>,
    last_raw_line: Mutex<String>,
    finished: AtomicBool,
}

impl SessionLog {
    pub fn create(vm: &VmConfig, logs_dir: &Path) -> io::Result<Self> {
        fs::create_dir_all(logs_dir)?;
        set_private_directory_permissions(logs_dir)?;

        let started_at_unix_ms = now_ms();
        let session_id = new_session_id(started_at_unix_ms);
        let log_path = logs_dir.join(format!("{session_id}.log"));
        let meta_path = logs_dir.join(format!("{session_id}.json"));

        let mut file = open_new_log(&log_path)?;
        let header = format!(
            "# Wave VM diagnostic log\n# session: {session_id}\n# vm: {} ({})\n# started: {}\n",
            vm.id,
            vm.name,
            format_timestamp(started_at_unix_ms)
        );
        file.write_all(header.as_bytes())?;
        file.flush()?;

        let log = Self {
            session_id,
            vm_id: vm.id.clone(),
            started_at_unix_ms,
            log_path,
            meta_path,
            file: Mutex::new(LogFile {
                file,
                total_bytes: header.len() as u64,
                raw_bytes: 0,
                raw_suppressed: false,
            }),
            last_raw_line: Mutex::new(String::new()),
            finished: AtomicBool::new(false),
        };

        log.write_meta(LogOutcome::Running, None, None, None)?;
        prune_sessions(logs_dir, &log.session_id);

        Ok(log)
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn log_path(&self) -> &Path {
        &self.log_path
    }

    pub fn log(
        &self,
        severity: LogSeverity,
        component: LogComponent,
        source: LogSource,
        message: &str,
    ) {
        let _ = self.write_entry(severity, component, source, message, false);
    }

    pub fn debug(&self, component: LogComponent, source: LogSource, message: &str) {
        self.log(LogSeverity::Debug, component, source, message);
    }

    pub fn info(&self, component: LogComponent, source: LogSource, message: &str) {
        self.log(LogSeverity::Info, component, source, message);
    }

    pub fn warn(&self, component: LogComponent, source: LogSource, message: &str) {
        self.log(LogSeverity::Warn, component, source, message);
    }

    pub fn error(&self, component: LogComponent, source: LogSource, message: &str) {
        self.log(LogSeverity::Error, component, source, message);
    }

    pub fn qemu_line(&self, source: LogSource, line: &str) {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            return;
        }

        {
            let mut last = lock_unpoisoned(&self.last_raw_line);
            *last = truncate_message(line, 4_000);
        }

        let severity = match source {
            LogSource::QemuStderr => severity_for_stderr(line),
            _ => LogSeverity::Info,
        };
        let message = sanitize_message(line);
        let rendered = render_line(now_ms(), severity, LogComponent::Qemu, source, &message);

        let mut guard = lock_unpoisoned(&self.file);

        if guard.raw_bytes >= MAX_RAW_BYTES {
            if !guard.raw_suppressed {
                guard.raw_suppressed = true;
                drop(guard);
                self.log(
                    LogSeverity::Warn,
                    LogComponent::Qemu,
                    LogSource::Application,
                    &format!(
                        "QEMU output limit reached ({} MiB); further raw output is suppressed.",
                        MAX_RAW_BYTES / (1024 * 1024)
                    ),
                );
            }
            return;
        }

        if guard.total_bytes >= MAX_TOTAL_BYTES {
            return;
        }

        if guard.file.write_all(rendered.as_bytes()).is_err() {
            return;
        }
        let _ = guard.file.flush();
        guard.total_bytes += rendered.len() as u64;
        guard.raw_bytes += rendered.len() as u64;
    }

    pub fn last_raw_line(&self) -> Option<String> {
        let last = lock_unpoisoned(&self.last_raw_line);
        if last.is_empty() {
            None
        } else {
            Some(last.clone())
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn finish(
        &self,
        outcome: LogOutcome,
        severity: LogSeverity,
        summary: &str,
        exit_code: Option<i32>,
        signal: Option<i32>,
    ) {
        if self.finished.swap(true, Ordering::SeqCst) {
            return;
        }

        let _ = self.write_entry(
            severity,
            LogComponent::Vm,
            LogSource::Application,
            summary,
            true,
        );
        let _ = self.write_meta(outcome, Some(summary), exit_code, signal);
    }

    fn write_entry(
        &self,
        severity: LogSeverity,
        component: LogComponent,
        source: LogSource,
        message: &str,
        force: bool,
    ) -> io::Result<()> {
        let message = sanitize_message(message);
        let rendered = render_line(now_ms(), severity, component, source, &message);
        let mut guard = lock_unpoisoned(&self.file);

        if !force && guard.total_bytes >= MAX_TOTAL_BYTES {
            return Ok(());
        }

        guard.file.write_all(rendered.as_bytes())?;
        guard.file.flush()?;
        guard.total_bytes += rendered.len() as u64;
        Ok(())
    }

    fn write_meta(
        &self,
        outcome: LogOutcome,
        summary: Option<&str>,
        exit_code: Option<i32>,
        signal: Option<i32>,
    ) -> io::Result<()> {
        let meta = SessionMeta {
            session_id: self.session_id.clone(),
            vm_id: self.vm_id.clone(),
            started_at_unix_ms: self.started_at_unix_ms,
            ended_at_unix_ms: if outcome == LogOutcome::Running {
                None
            } else {
                Some(now_ms())
            },
            outcome,
            summary: summary.map(str::to_string),
            exit_code,
            signal,
        };

        write_meta_file(&self.meta_path, &meta)
    }
}

pub fn read_view(
    logs_dir: &Path,
    vm_id: &str,
    current_session: Option<&str>,
    requested_session: Option<&str>,
) -> io::Result<VmLogView> {
    let sessions = list_sessions(logs_dir, current_session);
    let selected = select_session(&sessions, current_session, requested_session);
    let selected_session_id = selected.map(|session| session.session_id.clone());
    let entries = match selected {
        Some(session) => read_session_entries(Path::new(&session.log_path))?,
        None => Vec::new(),
    };

    Ok(VmLogView {
        vm_id: vm_id.to_string(),
        log_directory: logs_dir.display().to_string(),
        sessions,
        selected_session_id,
        entries,
    })
}

pub fn list_sessions(logs_dir: &Path, current_session: Option<&str>) -> Vec<LogSessionInfo> {
    let mut sessions = Vec::new();
    let Ok(entries) = fs::read_dir(logs_dir) else {
        return sessions;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<SessionMeta>(&text) else {
            continue;
        };

        let log_path = path.with_extension("log");
        if !log_path.is_file() {
            continue;
        }

        let size_bytes = fs::metadata(&log_path).map(|meta| meta.len()).unwrap_or(0);
        sessions.push(LogSessionInfo {
            is_current: current_session == Some(meta.session_id.as_str()),
            session_id: meta.session_id,
            started_at_unix_ms: meta.started_at_unix_ms,
            ended_at_unix_ms: meta.ended_at_unix_ms,
            outcome: meta.outcome,
            summary: meta.summary,
            exit_code: meta.exit_code,
            signal: meta.signal,
            log_path: log_path.display().to_string(),
            size_bytes,
        });
    }

    sessions.sort_by(|left, right| {
        right
            .started_at_unix_ms
            .cmp(&left.started_at_unix_ms)
            .then_with(|| right.session_id.cmp(&left.session_id))
    });
    sessions
}

pub fn select_session<'a>(
    sessions: &'a [LogSessionInfo],
    current_session: Option<&str>,
    requested_session: Option<&str>,
) -> Option<&'a LogSessionInfo> {
    requested_session
        .and_then(|id| sessions.iter().find(|session| session.session_id == id))
        .or_else(|| {
            current_session.and_then(|id| sessions.iter().find(|session| session.session_id == id))
        })
        .or_else(|| sessions.first())
}

pub fn read_session_entries(path: &Path) -> io::Result<Vec<LogEntry>> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for line in reader.lines() {
        let line = line?;
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }
        entries.push(parse_entry(line));
    }

    Ok(entries)
}

pub fn read_session_text(path: &Path) -> io::Result<String> {
    fs::read_to_string(path)
}

pub fn mark_untracked_sessions(logs_dir: &Path, summary: &str) {
    let Ok(entries) = fs::read_dir(logs_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let meta_path = entry.path();
        if meta_path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let Ok(text) = fs::read_to_string(&meta_path) else {
            continue;
        };
        let Ok(mut meta) = serde_json::from_str::<SessionMeta>(&text) else {
            continue;
        };

        if meta.outcome != LogOutcome::Running || meta.ended_at_unix_ms.is_some() {
            continue;
        }

        meta.outcome = LogOutcome::UnexpectedExit;
        meta.ended_at_unix_ms = Some(now_ms());
        meta.summary = Some(summary.to_string());

        let _ = write_meta_file(&meta_path, &meta);
        let log_path = meta_path.with_extension("log");
        let _ = append_entry(
            &log_path,
            LogSeverity::Warn,
            LogComponent::Vm,
            LogSource::Application,
            summary,
        );
    }
}

fn parse_entry(line: &str) -> LogEntry {
    if let Some(entry) = parse_structured_entry(line) {
        return entry;
    }

    LogEntry {
        timestamp_ms: 0,
        severity: LogSeverity::Info,
        component: LogComponent::Qemu,
        source: LogSource::QemuStdout,
        message: truncate_message(line, MAX_MESSAGE_CHARS),
    }
}

fn parse_structured_entry(line: &str) -> Option<LogEntry> {
    let rest = line.strip_prefix('[')?;
    let (timestamp, rest) = rest.split_once("] [")?;
    let (severity, rest) = rest.split_once("] [")?;
    let (component, rest) = rest.split_once("] [")?;
    let (source, message) = rest.split_once("] ")?;

    Some(LogEntry {
        timestamp_ms: parse_timestamp(timestamp)?,
        severity: LogSeverity::parse(severity)?,
        component: LogComponent::parse(component)?,
        source: LogSource::parse(source)?,
        message: message.to_string(),
    })
}

fn render_line(
    timestamp_ms: u64,
    severity: LogSeverity,
    component: LogComponent,
    source: LogSource,
    message: &str,
) -> String {
    format!(
        "[{}] [{}] [{}] [{}] {}\n",
        format_timestamp(timestamp_ms),
        severity.label(),
        component.label(),
        source.label(),
        message
    )
}

fn severity_for_stderr(line: &str) -> LogSeverity {
    let lower = line.to_ascii_lowercase();

    if lower.contains("error")
        || lower.contains("failed")
        || lower.contains("failure")
        || lower.contains("fatal")
        || lower.contains("abort")
        || lower.contains("panic")
        || lower.contains("cannot")
        || lower.contains("could not")
        || lower.contains("unable")
        || lower.contains("invalid")
        || lower.contains("not found")
        || lower.contains("no such")
    {
        LogSeverity::Error
    } else {
        LogSeverity::Warn
    }
}

fn sanitize_message(value: &str) -> String {
    let value = value.replace('\r', " ");
    let value = value.replace('\n', "\\n");
    truncate_message(&value, MAX_MESSAGE_CHARS)
}

fn truncate_message(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }

    let mut truncated: String = value.chars().take(limit).collect();
    truncated.push_str("… (truncated)");
    truncated
}

fn new_session_id(started_at_unix_ms: u64) -> String {
    let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{started_at_unix_ms}-{}-{counter}", std::process::id())
}

fn prune_sessions(logs_dir: &Path, keep_session: &str) {
    let mut sessions: Vec<(u64, String, PathBuf)> = Vec::new();
    let Ok(entries) = fs::read_dir(logs_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }

        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<SessionMeta>(&text) else {
            continue;
        };

        sessions.push((meta.started_at_unix_ms, meta.session_id, path));
    }

    sessions.sort_by(|left, right| right.0.cmp(&left.0));

    for (_, session_id, meta_path) in sessions.into_iter().skip(MAX_SESSIONS) {
        if session_id == keep_session {
            continue;
        }

        let _ = fs::remove_file(meta_path.with_extension("log"));
        let _ = fs::remove_file(&meta_path);
    }
}

fn append_entry(
    path: &Path,
    severity: LogSeverity,
    component: LogComponent,
    source: LogSource,
    message: &str,
) -> io::Result<()> {
    let mut file = OpenOptions::new().append(true).open(path)?;
    let rendered = render_line(
        now_ms(),
        severity,
        component,
        source,
        &sanitize_message(message),
    );
    file.write_all(rendered.as_bytes())?;
    file.flush()
}

fn open_new_log(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    options.open(path)
}

fn write_meta_file(path: &Path, meta: &SessionMeta) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "the diagnostic metadata path has no parent directory",
        )
    })?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("session");
    let temporary = parent.join(format!(".{file_name}.tmp-{}", std::process::id()));

    let mut bytes = serde_json::to_vec_pretty(meta)
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
    bytes.push(b'\n');

    {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }

        let mut file = options.open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }

    fs::rename(&temporary, path)
}

fn set_private_directory_permissions(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }

    #[cfg(not(unix))]
    let _ = path;

    Ok(())
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn format_timestamp(timestamp_ms: u64) -> String {
    let total_seconds = timestamp_ms / 1000;
    let millis = timestamp_ms % 1000;
    let days = (total_seconds / 86_400) as i64;
    let seconds_of_day = total_seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn parse_timestamp(value: &str) -> Option<u64> {
    let value = value.strip_suffix('Z')?;
    let (date, time) = value.split_once('T')?;

    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;

    let (time, millis) = time.split_once('.')?;
    let millis: u64 = millis.parse().ok()?;

    let mut time_parts = time.split(':');
    let hour: u64 = time_parts.next()?.parse().ok()?;
    let minute: u64 = time_parts.next()?.parse().ok()?;
    let second: u64 = time_parts.next()?.parse().ok()?;

    let days = days_from_civil(year, month, day);
    let seconds = days.checked_mul(86_400)? + (hour * 3_600 + minute * 60 + second) as i64;
    let seconds = u64::try_from(seconds).ok()?;

    Some(seconds.checked_mul(1000)? + millis)
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = (shifted - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_prime + 2) / 5 + 1) as u32;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    } as u32;

    (if month <= 2 { year + 1 } else { year }, month, day)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = (year - era * 400) as u64;
    let month_prime = if month > 2 { month - 3 } else { month + 9 } as u64;
    let day_of_year = (153 * month_prime + 2) / 5 + (day as u64 - 1);
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era as i64 - 719_468
}
