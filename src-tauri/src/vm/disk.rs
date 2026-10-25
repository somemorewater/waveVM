use std::path::Path;
use std::process::{Command, Stdio};

use super::VmError;

pub fn create_qcow2(qemu_img: &Path, disk_path: &Path, size_gib: u32) -> Result<(), VmError> {
    if disk_path.exists() {
        return Err(VmError::Disk(format!(
            "refusing to overwrite the existing disk {}",
            disk_path.display()
        )));
    }

    let output = Command::new(qemu_img)
        .arg("create")
        .arg("-q")
        .arg("-f")
        .arg("qcow2")
        .arg(disk_path)
        .arg(format!("{size_gib}G"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| VmError::Disk(format!("could not run {}: {error}", qemu_img.display())))?;

    if !output.status.success() {
        let detail = first_line(&output.stderr)
            .or_else(|| first_line(&output.stdout))
            .unwrap_or_else(|| format!("qemu-img exited with status {}", output.status));
        return Err(VmError::Disk(detail));
    }

    if !disk_path.is_file() {
        return Err(VmError::Disk(format!(
            "qemu-img reported success but {} does not exist",
            disk_path.display()
        )));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        std::fs::set_permissions(disk_path, std::fs::Permissions::from_mode(0o600)).map_err(
            |error| {
                VmError::Disk(format!(
                    "the disk was created but its permissions could not be restricted: {error}"
                ))
            },
        )?;
    }

    Ok(())
}

fn first_line(bytes: &[u8]) -> Option<String> {
    let value = String::from_utf8_lossy(bytes);
    let line = value.lines().find(|line| !line.trim().is_empty())?.trim();
    Some(line.chars().take(400).collect())
}
