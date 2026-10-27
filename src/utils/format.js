const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

const OS_LABELS = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
  freebsd: "FreeBSD",
};

const SOURCE_LABELS = {
  bundled: "Bundled resource",
  path: "PATH",
  system: "System location",
};

const WARNING_LABELS = {
  info: "Info",
  warning: "Warning",
  error: "Error",
};

const TOOL_TONES = {
  available: "ok",
  missing: "warn",
  failed: "error",
  unsupported: "neutral",
};

const KVM_TONES = {
  usable: "ok",
  missing: "warn",
  inaccessible: "warn",
  error: "error",
  unsupported: "neutral",
};

const CHECK_TONES = {
  ok: "ok",
  unsupported: "neutral",
  error: "error",
};

const TOOL_LABELS = {
  available: "Available",
  missing: "Not found",
  failed: "Probe failed",
  unsupported: "Unsupported",
};

const KVM_LABELS = {
  usable: "Usable",
  missing: "Not found",
  inaccessible: "No access",
  error: "Probe failed",
  unsupported: "Not applicable",
};

const CHECK_LABELS = {
  ok: "Available",
  unsupported: "Unavailable",
  error: "Error",
};

const VM_STATE_LABELS = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  error: "Error",
};

const VM_STATE_TONES = {
  stopped: "neutral",
  starting: "warn",
  running: "ok",
  stopping: "warn",
  error: "error",
};

const ACCELERATION_LABELS = {
  kvm: "KVM acceleration",
  tcg: "TCG software emulation",
};

export function formatBytes(bytes) {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return "Unavailable";
  }

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const maximumFractionDigits = unit === 0 || value >= 100 ? 0 : 1;
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
  }).format(value);

  return `${formatted} ${BYTE_UNITS[unit]}`;
}

export function formatCount(value) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }
  return new Intl.NumberFormat().format(value);
}

export function formatTimestamp(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

export function formatRelativeTime(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "Unknown";
  }

  const seconds = timestamp - Date.now() / 1000;
  const absolute = Math.abs(seconds);

  if (absolute < 45) {
    return "just now";
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absolute < 3600) {
    return formatter.format(Math.round(seconds / 60), "minute");
  }

  if (absolute < 86400) {
    return formatter.format(Math.round(seconds / 3600), "hour");
  }

  if (absolute < 604800) {
    return formatter.format(Math.round(seconds / 86400), "day");
  }

  return formatTimestamp(timestamp);
}

export function formatMemory(mib) {
  return `${formatCount(mib)} MiB`;
}

export function formatDisk(gib) {
  return `${formatCount(gib)} GiB`;
}

export function osLabel(os) {
  return OS_LABELS[os] || os || "Unknown";
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || "Unknown";
}

export function warningLabel(severity) {
  return WARNING_LABELS[severity] || "Notice";
}

export function toolTone(status) {
  return TOOL_TONES[status] || "neutral";
}

export function kvmTone(status) {
  return KVM_TONES[status] || "neutral";
}

export function checkTone(status) {
  return CHECK_TONES[status] || "neutral";
}

export function toolLabel(status) {
  return TOOL_LABELS[status] || "Unknown";
}

export function kvmLabel(status) {
  return KVM_LABELS[status] || "Unknown";
}

export function checkLabel(status) {
  return CHECK_LABELS[status] || "Unknown";
}

export function vmStateLabel(state) {
  return VM_STATE_LABELS[state] || "Unknown";
}

export function vmStateTone(state) {
  return VM_STATE_TONES[state] || "neutral";
}

export function accelerationLabel(value) {
  return ACCELERATION_LABELS[value] || "Not running";
}

export function bootModeLabel(mode) {
  return mode === "installer" ? "Installer boot" : "Disk boot";
}

export function fileName(path) {
  if (typeof path !== "string" || path.length === 0) {
    return "";
  }

  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}
