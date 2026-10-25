import { element, text } from "../utils/dom.js";
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
} from "../utils/format.js";
import { appendAlert } from "./alerts.js";
import { skeletonGrid } from "./skeleton.js";
import { statusIndicator } from "./status-indicator.js";

const ALL_CARDS = ["system", "kvm", "qemu", "qemuImg", "storage", "localData"];

export function renderHostLoading(container, count = 4) {
  container.replaceChildren(skeletonGrid(count));
}

export function renderHostCards(
  container,
  { host, appInfo, appInfoError, include = ALL_CARDS },
) {
  if (!host) {
    renderHostError(container, {
      code: "host_unavailable",
      message: "Host diagnostics have not returned data.",
    });
    return;
  }

  const cards = [];

  if (include.includes("system")) {
    cards.push(systemCard(host));
  }
  if (include.includes("kvm")) {
    cards.push(kvmCard(host.kvm));
  }
  if (include.includes("qemu")) {
    cards.push(toolCard(host.qemu, "QEMU system emulator", "Runtime executable"));
  }
  if (include.includes("qemuImg")) {
    cards.push(toolCard(host.qemuImg, "qemu-img", "Disk image utility"));
  }
  if (include.includes("storage")) {
    cards.push(storageCard(host.storage));
  }
  if (include.includes("localData")) {
    cards.push(localDataCard(appInfo, appInfoError));
  }

  container.replaceChildren(...cards);
}

export function renderHostError(container, error) {
  container.replaceChildren(
    element("div", {
      className: "error-card",
      children: [
        element("h3", { text: "Host diagnostics could not be completed" }),
        element("p", { text: error.message }),
        element("p", {
          className: "error-code",
          text: `Error code: ${error.code}`,
        }),
      ],
    }),
  );
}

export function appendHostWarnings(container, host, appInfoError) {
  const warnings = Array.isArray(host?.warnings) ? host.warnings : [];

  for (const warning of warnings) {
    appendAlert(container, warning);
  }

  if (appInfoError) {
    appendAlert(container, {
      severity: "error",
      title: "Local configuration unavailable",
      message: appInfoError.message,
      code: appInfoError.code,
    });
  }
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
        value:
          host.cpuLogical === null || host.cpuLogical === undefined
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
            message: text(
              memory.detail,
              "Memory information is not available on this host.",
            ),
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
      {
        label: "Present",
        value: kvm.devicePresent ? "Yes" : "No",
        muted: !kvm.devicePresent,
      },
      {
        label: "Verified",
        value: kvm.verified ? "Yes, kernel accepted the probe" : "No",
        muted: !kvm.verified,
      },
      {
        label: "API version",
        value:
          kvm.apiVersion === null || kvm.apiVersion === undefined
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
    {
      label: "Executable",
      value: text(tool.executable, "Not selected"),
      code: true,
    },
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
            message: text(
              storage.detail,
              "Storage information is not available on this host.",
            ),
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
          kicker
            ? element("p", { className: "host-card-kicker", text: kicker })
            : null,
        ],
      }),
      badge ? statusIndicator(badge) : null,
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
