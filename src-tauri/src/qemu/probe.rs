use std::fmt;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUTPUT_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Available,
    Missing,
    Failed,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolSource {
    Bundled,
    Path,
    System,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub status: ToolStatus,
    pub label: String,
    pub executable: Option<String>,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: Option<ToolSource>,
    pub detail: Option<String>,
}

impl ToolInfo {
    pub fn available(
        label: &str,
        executable: &str,
        path: &Path,
        version: Option<String>,
        source: ToolSource,
        detail: Option<String>,
    ) -> Self {
        Self {
            status: ToolStatus::Available,
            label: label.to_string(),
            executable: Some(executable.to_string()),
            path: Some(path.display().to_string()),
            version,
            source: Some(source),
            detail,
        }
    }

    pub fn missing(label: &str, executable: Option<&str>, detail: String) -> Self {
        Self {
            status: ToolStatus::Missing,
            label: label.to_string(),
            executable: executable.map(str::to_string),
            path: None,
            version: None,
            source: None,
            detail: Some(detail),
        }
    }

    pub fn failed(
        label: &str,
        executable: &str,
        path: &Path,
        source: ToolSource,
        detail: String,
    ) -> Self {
        Self {
            status: ToolStatus::Failed,
            label: label.to_string(),
            executable: Some(executable.to_string()),
            path: Some(path.display().to_string()),
            version: None,
            source: Some(source),
            detail: Some(detail),
        }
    }

    pub fn unsupported(label: &str, executable: Option<&str>, detail: String) -> Self {
        Self {
            status: ToolStatus::Unsupported,
            label: label.to_string(),
            executable: executable.map(str::to_string),
            path: None,
            version: None,
            source: None,
            detail: Some(detail),
        }
    }
}

#[derive(Debug)]
pub struct ProbeOutput {
    pub version: Option<String>,
    pub summary: String,
}

#[derive(Debug)]
pub enum ProbeError {
    Spawn(String),
    Timeout,
    NonZeroExit { status: String, stderr: String },
    EmptyOutput,
}

impl fmt::Display for ProbeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(message) => write!(formatter, "could not start the executable: {message}"),
            Self::Timeout => write!(
                formatter,
                "the executable did not respond within {} seconds",
                PROBE_TIMEOUT.as_secs()
            ),
            Self::NonZeroExit { status, stderr } if stderr.is_empty() => {
                write!(formatter, "the executable exited with status {status}")
            }
            Self::NonZeroExit { status, stderr } => {
                write!(
                    formatter,
                    "the executable exited with status {status}: {stderr}"
                )
            }
            Self::EmptyOutput => write!(formatter, "the executable returned no version output"),
        }
    }
}

pub fn probe_version(path: &Path) -> Result<ProbeOutput, ProbeError> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    command.env("LC_ALL", "C");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|error| ProbeError::Spawn(error.to_string()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ProbeError::Spawn("stdout was not captured".to_string()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ProbeError::Spawn("stderr was not captured".to_string()))?;

    let stdout_reader = thread::spawn(move || read_limited(stdout));
    let stderr_reader = thread::spawn(move || read_limited(stderr));

    let deadline = Instant::now() + PROBE_TIMEOUT;
    let mut timed_out = false;

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(ProbeError::Spawn(format!(
                    "could not wait for the process: {error}"
                )));
            }
        }
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();

    if timed_out {
        return Err(ProbeError::Timeout);
    }

    let status = status.expect("a process status exists when the probe did not time out");

    if !status.success() {
        return Err(ProbeError::NonZeroExit {
            status: status.code().map_or_else(
                || "terminated by signal".to_string(),
                |code| code.to_string(),
            ),
            stderr: first_line(&stderr, 200),
        });
    }

    let summary = first_line(&stdout, 240);

    if summary.is_empty() {
        return Err(ProbeError::EmptyOutput);
    }

    Ok(ProbeOutput {
        version: parse_version(&stdout),
        summary,
    })
}

fn read_limited<R: Read>(stream: R) -> String {
    let mut bytes = Vec::new();
    let _ = stream.take(MAX_OUTPUT_BYTES).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

fn first_line(value: &str, limit: usize) -> String {
    let line = value
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    line.chars().take(limit).collect()
}

fn parse_version(output: &str) -> Option<String> {
    let line = output.lines().find(|line| !line.trim().is_empty())?;

    let mut previous = None;
    for token in line.split_whitespace() {
        if previous == Some("version") {
            if let Some(version) = clean_version(token) {
                return Some(version);
            }
        }
        previous = Some(token);
    }

    for token in line.split_whitespace() {
        if let Some(candidate) = clean_version(token) {
            if candidate
                .chars()
                .any(|character| character.is_ascii_digit())
                && candidate.contains('.')
            {
                return Some(candidate);
            }
        }
    }

    None
}

fn clean_version(token: &str) -> Option<String> {
    let cleaned = token.trim_matches(|character: char| {
        !(character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | '+'))
    });

    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}
