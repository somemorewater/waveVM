use std::fs::File;
use std::path::Path;

use super::VmError;

/// Validates a user-selected ISO path and returns its canonical UTF-8 form.
///
/// The file is only inspected; it is never copied, moved, or modified.
pub fn validate_iso_file(value: &str) -> Result<String, VmError> {
    let candidate = value.trim();

    if candidate.is_empty() {
        return Err(VmError::Validation(
            "no installation ISO was selected".to_string(),
        ));
    }

    let path = Path::new(candidate);

    if !path.is_absolute() {
        return Err(VmError::Validation(format!(
            "the installation ISO path must be absolute: {}",
            path.display()
        )));
    }

    let canonical = path.canonicalize().map_err(|error| {
        VmError::Validation(format!(
            "the installation ISO {} could not be resolved: {error}",
            path.display()
        ))
    })?;

    let metadata = std::fs::metadata(&canonical).map_err(|error| {
        VmError::Validation(format!(
            "the installation ISO {} could not be inspected: {error}",
            path.display()
        ))
    })?;

    if !metadata.is_file() {
        return Err(VmError::Validation(format!(
            "the installation ISO {} is not a regular file",
            canonical.display()
        )));
    }

    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    if !extension.eq_ignore_ascii_case("iso") {
        return Err(VmError::Validation(format!(
            "the installation media {} must be an .iso file",
            canonical.display()
        )));
    }

    File::open(&canonical).map_err(|error| {
        VmError::Validation(format!(
            "the installation ISO {} is not readable: {error}",
            canonical.display()
        ))
    })?;

    let stored = canonical.into_os_string().into_string().map_err(|_| {
        VmError::Unsupported(
            "the selected ISO path must be valid UTF-8 to be stored in the configuration"
                .to_string(),
        )
    })?;

    if stored.contains(',') || stored.contains('\n') || stored.contains('\r') {
        return Err(VmError::Unsupported(
            "the selected ISO path contains a character QEMU option parsing cannot safely accept"
                .to_string(),
        ));
    }

    Ok(stored)
}

pub fn iso_available(value: &str) -> bool {
    Path::new(value).is_file()
}
