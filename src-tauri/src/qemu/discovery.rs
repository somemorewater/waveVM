use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};

use super::probe::{probe_version, ToolInfo, ToolSource};

struct Candidate {
    path: PathBuf,
    source: ToolSource,
}

pub fn discover_system_emulator(resource_dir: Option<&Path>, arch: &str) -> ToolInfo {
    let label = "QEMU system emulator";

    let Some(executable) = super::system_emulator_name(arch) else {
        return ToolInfo::unsupported(
            label,
            None,
            format!(
                "No QEMU system emulator mapping is known for the host architecture \"{arch}\"."
            ),
        );
    };

    discover(label, executable, resource_dir)
}

pub fn discover_qemu_img(resource_dir: Option<&Path>) -> ToolInfo {
    discover("qemu-img", "qemu-img", resource_dir)
}

fn discover(label: &str, executable: &str, resource_dir: Option<&Path>) -> ToolInfo {
    let executable_name = format!("{executable}{}", env::consts::EXE_SUFFIX);
    let candidates = candidates(&executable_name, resource_dir);

    if candidates.is_empty() {
        return ToolInfo::missing(
            label,
            Some(executable),
            format!(
                "No {executable_name} executable was found in bundled resources, PATH, or standard system locations."
            ),
        );
    }

    let mut failures = Vec::new();

    for candidate in &candidates {
        match probe_version(&candidate.path) {
            Ok(output) => {
                let detail = if output.version.is_none() {
                    Some(format!(
                        "The executable responded, but its version could not be parsed: {}",
                        output.summary
                    ))
                } else {
                    None
                };

                return ToolInfo::available(
                    label,
                    executable,
                    &candidate.path,
                    output.version,
                    candidate.source,
                    detail,
                );
            }
            Err(error) => {
                failures.push(format!("{}: {error}", candidate.path.display()));
            }
        }
    }

    let first = &candidates[0];
    ToolInfo::failed(
        label,
        executable,
        &first.path,
        first.source,
        format!(
            "Found {} candidate{} but none responded successfully. {}",
            candidates.len(),
            if candidates.len() == 1 { "" } else { "s" },
            failures.join("; ")
        ),
    )
}

fn candidates(executable_name: &str, resource_dir: Option<&Path>) -> Vec<Candidate> {
    let mut candidates = Vec::new();

    if let Some(resource_dir) = resource_dir {
        for relative in ["qemu/bin", "qemu"] {
            push_if_file(
                &mut candidates,
                resource_dir.join(relative).join(executable_name),
                ToolSource::Bundled,
            );
        }
    }

    if let Some(paths) = env::var_os("PATH") {
        for directory in env::split_paths(&paths) {
            if directory.as_os_str().is_empty() {
                continue;
            }
            push_if_file(
                &mut candidates,
                directory.join(executable_name),
                ToolSource::Path,
            );
        }
    }

    for directory in platform_directories() {
        push_if_file(
            &mut candidates,
            directory.join(executable_name),
            ToolSource::System,
        );
    }

    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.path.clone()));
    candidates
}

fn push_if_file(candidates: &mut Vec<Candidate>, path: PathBuf, source: ToolSource) {
    if path.is_file() {
        candidates.push(Candidate { path, source });
    }
}

fn platform_directories() -> Vec<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        let mut directories = vec![
            PathBuf::from("/usr/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/libexec"),
            PathBuf::from("/opt/qemu/bin"),
        ];

        if let Some(home) = env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local/bin"));
        }

        directories
    }

    #[cfg(target_os = "macos")]
    {
        let mut directories = vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/Applications/QEMU.app/Contents/MacOS"),
        ];

        if let Some(home) = env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local/bin"));
        }

        directories
    }

    #[cfg(target_os = "windows")]
    {
        let mut directories = Vec::new();

        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(base) = env::var_os(variable) {
                let base = PathBuf::from(base);
                directories.push(base.join("qemu"));
                directories.push(base.join("QEMU"));
            }
        }

        directories
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}
