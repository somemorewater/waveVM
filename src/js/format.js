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
