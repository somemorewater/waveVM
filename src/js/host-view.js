import { clear, element, text } from "./dom.js";
import {
  checkLabel,
  checkTone,
  formatBytes,
  formatCount,
  formatTimestamp,
  kvmLabel,
  kvmTone,
  osLabel,
  sourceLabel,
  toolLabel,
  toolTone,
  warningLabel,
} from "./format.js";

export function setSummary(node, label, tone) {
  node.textContent = label;
  node.dataset.tone = tone;
}

export function renderLoading(panel, summary) {
  setSummary(summary, "Checking host", "neutral");
  clear(panel);

  for (let index = 0; index < 4; index += 1) {
    panel.append(
      element("div", {
        className: "skeleton-card",
        children: [
          element("span", { className: "skeleton-line skeleton-line-short" }),
          element("span", { className: "skeleton-line" }),
          element("span", { className: "skeleton-line skeleton-line-medium" }),
        ],
      }),
    );
  }
}

export function renderAppMeta(node, appInfo) {
  if (appInfo && appInfo.version) {
    node.textContent = `v${appInfo.version}`;
  }
}

export function renderHost(panel, host, appInfo, appInfoError) {
  clear(panel);
  panel.setAttribute("aria-busy", "false");

  panel.append(
    systemCard(host),
    kvmCard(host.kvm),
    toolCard(host.qemu, "QEMU system emulator", "Runtime executable"),
    toolCard(host.qemuImg, "qemu-img", "Disk image utility"),
    storageCard(host.storage),
    localDataCard(appInfo, appInfoError),
  );

  const summary = summarize(host.warnings, appInfoError);
  setSummary(document.querySelector("#host-summary"), summary.label, summary.tone);

  const alertRegion = document.querySelector("#global-alert");
  renderWarnings(alertRegion, host.warnings);
  if (appInfoError) {
    appendAlert(alertRegion, {
      severity: "error",
      title: "Local configuration unavailable",
      message: `${appInfoError.message} (${appInfoError.code})`,
    });
  }
}

export function renderHostError(panel, error, alertRegion, appInfoError) {
  clear(panel);
  panel.setAttribute("aria-busy", "false");

  panel.append(
    element("div", {
      className: "error-card",
      children: [
        element("h3", { text: "Host diagnostics could not be completed" }),
        element("p", { text: error.message }),
        element("p", { className: "error-code", text: `Error code: ${error.code}` }),
      ],
    }),
  );

  setSummary(document.querySelector("#host-summary"), "Diagnostics failed", "error");
  clear(alertRegion);
  appendAlert(alertRegion, {
    severity: "error",
    title: "Host diagnostics failed",
    message: error.message,
  });

  if (appInfoError) {
    appendAlert(alertRegion, {
      severity: "error",
      title: "Local configuration unavailable",
      message: `${appInfoError.message} (${appInfoError.code})`,
    });
  }
}

function summarize(warnings, appInfoError) {
  const list = Array.isArray(warnings) ? warnings : [];
  const hasError = Boolean(appInfoError) || list.some((item) => item.severity === "error");
  const hasWarning = list.some((item) => item.severity === "warning");

  if (hasError) {
    return { label: "Attention needed", tone: "error" };
  }

  if (hasWarning) {
    return { label: "Setup incomplete", tone: "warn" };
  }

  return { label: "Diagnostics complete", tone: "ok" };
}

function systemCard(host) {
  const memory = host.memory || {};
  const memoryValue =
    memory.totalBytes === null || memory.totalBytes === undefined
      ? "Unavailable"
      : memory.availableBytes === null || memory.availableBytes === undefined
        ? `${formatBytes(memory.totalBytes)} total`
        : `${formatBytes(memory.availableBytes)} available of ${formatBytes(memory.totalBytes)}`;

  return hostCard({
    title: "System",
    kicker: "Reported by the host",
    badge: {
      label: checkLabel(memory.status),
      tone: checkTone(memory.status),
    },
    rows: [
      { label: "OS", value: osLabel(host.os) },
      { label: "Architecture", value: host.arch, code: true },
      {
        label: "Logical CPUs",
        value: host.cpuLogical === null || host.cpuLogical === undefined
          ? "Unavailable"
          : formatCount(host.cpuLogical),
        muted: host.cpuLogical === null || host.cpuLogical === undefined,
      },
      { label: "Memory", value: memoryValue },
      { label: "Checked", value: formatTimestamp(host.collectedAtUnix) },
    ],
    note:
      memory.status === "ok"
        ? null
        : {
            tone: checkTone(memory.status),
            message: text(memory.detail, "Memory information is not available on this host."),
          },
  });
}

function kvmCard(kvm) {
  const noteTone =
    kvm.status === "usable"
      ? "ok"
      : kvm.status === "error"
        ? "error"
        : kvm.status === "unsupported"
          ? "neutral"
          : "warn";

  return hostCard({
    title: "KVM acceleration",
    kicker: "Linux hardware virtualization",
    badge: {
      label: kvmLabel(kvm.status),
      tone: kvmTone(kvm.status),
    },
    rows: [
      { label: "Device", value: kvm.devicePath, code: true },
      { label: "Present", value: kvm.devicePresent ? "Yes" : "No", muted: !kvm.devicePresent },
      {
        label: "Verified",
        value: kvm.verified ? "Yes, kernel accepted the probe" : "No",
        muted: !kvm.verified,
      },
      {
        label: "API version",
        value: kvm.apiVersion === null || kvm.apiVersion === undefined
          ? "Not reported"
          : formatCount(kvm.apiVersion),
        muted: kvm.apiVersion === null || kvm.apiVersion === undefined,
      },
    ],
    note: {
      tone: noteTone,
      message: text(kvm.detail, "No KVM detail was reported."),
    },
  });
}

function toolCard(tool, title, kicker) {
  const rows = [
    { label: "Executable", value: text(tool.executable, "Not selected"), code: true },
    {
      label: "Version",
      value: text(tool.version, "Not reported"),
      muted: !tool.version,
    },
  ];

  if (tool.path) {
    rows.push({ label: "Source", value: sourceLabel(tool.source) });
    rows.push({ label: "Path", value: tool.path, code: true });
  }

  const noteTone =
    tool.status === "failed"
      ? "error"
      : tool.status === "missing"
        ? "warn"
        : "neutral";

  return hostCard({
    title,
    kicker,
    badge: {
      label: toolLabel(tool.status),
      tone: toolTone(tool.status),
    },
    rows,
    note: tool.detail
      ? {
          tone: noteTone,
          message: tool.detail,
        }
      : null,
  });
}

function storageCard(storage) {
  const noteTone = storage.status === "error" ? "error" : "neutral";

  return hostCard({
    title: "Application storage",
    kicker: "Local data filesystem",
    badge: {
      label: checkLabel(storage.status),
      tone: checkTone(storage.status),
    },
    rows: [
      {
        label: "Data path",
        value: text(storage.appDataDir, "Unavailable"),
        code: Boolean(storage.appDataDir),
        muted: !storage.appDataDir,
      },
      {
        label: "Mount point",
        value: text(storage.mountPoint, "Unavailable"),
        code: Boolean(storage.mountPoint),
        muted: !storage.mountPoint,
      },
      {
        label: "Free space",
        value: formatBytes(storage.freeBytes),
        muted: storage.freeBytes === null || storage.freeBytes === undefined,
      },
      {
        label: "Total space",
        value: formatBytes(storage.totalBytes),
        muted: storage.totalBytes === null || storage.totalBytes === undefined,
      },
    ],
    note:
      storage.status === "ok"
        ? null
        : {
            tone: noteTone,
            message: text(storage.detail, "Storage information is not available on this host."),
          },
  });
}

function localDataCard(appInfo, appInfoError) {
  if (appInfoError) {
    return hostCard({
      title: "Local data",
      kicker: "Application configuration",
      badge: { label: "Error", tone: "error" },
      rows: [],
      note: {
        tone: "error",
        message: `${appInfoError.message} (${appInfoError.code})`,
      },
      wide: true,
    });
  }

  if (!appInfo) {
    return hostCard({
      title: "Local data",
      kicker: "Application configuration",
      badge: { label: "Unavailable", tone: "neutral" },
      rows: [],
      note: {
        tone: "neutral",
        message: "Local configuration details were not returned by the backend.",
      },
      wide: true,
    });
  }

  return hostCard({
    title: "Local data",
    kicker: "Application configuration",
    badge: { label: "Ready", tone: "ok" },
    rows: [
      { label: "Version", value: `Wave VM ${appInfo.version}` },
      { label: "Schema", value: `v${appInfo.schemaVersion}`, code: true },
      { label: "VM directory", value: appInfo.vmsDir, code: true },
      { label: "Config file", value: appInfo.configPath, code: true },
      { label: "Last opened", value: formatTimestamp(appInfo.lastOpenedUnix) },
    ],
    note: {
      tone: "neutral",
      message:
        "Configuration is written atomically in the platform application data directory. No cloud service is involved.",
    },
    wide: true,
  });
}

function hostCard({ title, kicker, badge, rows, note, wide = false }) {
  const header = element("div", {
    className: "host-card-header",
    children: [
      element("div", {
        children: [
          element("h3", { text: title }),
          kicker ? element("p", { className: "host-card-kicker", text: kicker }) : null,
        ],
      }),
      badge ? element("span", {
        className: "badge",
        text: badge.label,
        attrs: { "data-tone": badge.tone },
      }) : null,
    ],
  });

  const children = [header];

  if (rows.length > 0) {
    children.push(
      element("dl", {
        className: "detail-list",
        children: rows.map(detailRow),
      }),
    );
  }

  if (note) {
    children.push(
      element("p", {
        className: "card-note",
        text: note.message,
        attrs: note.tone ? { "data-tone": note.tone } : {},
      }),
    );
  }

  return element("article", {
    className: wide ? "host-card host-card-wide" : "host-card",
    children,
  });
}

function detailRow({ label, value, code = false, muted = false }) {
  const content = code
    ? element("code", { text: text(value) })
    : document.createTextNode(text(value));

  return element("div", {
    className: "detail-row",
    children: [
      element("dt", { text: label }),
      element("dd", {
        className: muted ? "is-muted" : "",
        children: [content],
      }),
    ],
  });
}

function renderWarnings(container, warnings) {
  clear(container);
  const list = Array.isArray(warnings) ? warnings : [];

  for (const warning of list) {
    appendAlert(container, warning);
  }
}

function appendAlert(container, warning) {
  const severity = warning.severity || "info";
  container.append(
    element("div", {
      className: "alert",
      attrs: {
        "data-severity": severity,
        role: "status",
      },
      children: [
        element("span", {
          className: "alert-label",
          text: warningLabel(severity),
        }),
        element("div", {
          className: "alert-copy",
          children: [
            element("span", {
              className: "alert-title",
              text: text(warning.title, "Host notice"),
            }),
            element("span", {
              className: "alert-message",
              text: text(warning.message, "No additional detail was provided."),
            }),
          ],
        }),
      ],
    }),
  );
}
