import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button, buttonLink } from "../../components/button.js";
import { createDetailList } from "../../components/detail-list.js";
import { createEmptyState } from "../../components/empty-state.js";
import { createErrorCard } from "../../components/error-card.js";
import { createPanel } from "../../components/panel.js";
import { skeletonGrid } from "../../components/skeleton.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { normalizeError } from "../../services/tauri.js";
import { exportVmLog, getVmLogs } from "../../services/vm-service.js";
import { element } from "../../utils/dom.js";
import { formatBytes, formatCount, vmStateLabel, vmStateTone } from "../../utils/format.js";

const LOG_POLL_INTERVAL = 2000;

const ACTIVE_STATES = new Set(["starting", "running", "stopping"]);

const OUTCOME_META = {
  running: {
    label: "Running",
    tone: "ok",
    description: "The QEMU process for this session is still running.",
  },
  stopped_by_user: {
    label: "Stopped by user",
    tone: "neutral",
    description: "Wave VM stopped the machine at your request.",
  },
  guest_shutdown: {
    label: "Guest shut down",
    tone: "ok",
    description: "The guest requested a clean shutdown through QEMU.",
  },
  process_failure: {
    label: "QEMU process failure",
    tone: "error",
    description: "QEMU exited with a non-zero status or an error signal.",
  },
  unexpected_exit: {
    label: "Unexpected exit",
    tone: "error",
    description:
      "The QEMU process ended without a recognized shutdown request.",
  },
  startup_failure: {
    label: "Startup failure",
    tone: "error",
    description: "The machine could not start and its process was cleaned up.",
  },
  application_shutdown: {
    label: "Application shutdown",
    tone: "warn",
    description:
      "Wave VM stopped the machine while the application was closing.",
  },
  guest_panic: {
    label: "Guest panic",
    tone: "error",
    description: "QEMU reported a GUEST_PANICKED event from the guest.",
  },
};

const SEVERITY_META = {
  debug: { label: "DEBUG", tone: "neutral", description: "Verbose diagnostic detail." },
  info: { label: "INFO", tone: "neutral", description: "Normal informational event." },
  warn: { label: "WARN", tone: "warn", description: "Warning that may need attention." },
  error: { label: "ERROR", tone: "error", description: "Error reported by Wave VM or QEMU." },
};

const SOURCE_META = {
  application: {
    label: "APP",
    description: "Wave VM application event",
  },
  qemu_stdout: {
    label: "STDOUT",
    description: "Raw QEMU standard output",
  },
  qemu_stderr: {
    label: "STDERR",
    description: "Raw QEMU standard error",
  },
  qmp_event: {
    label: "QMP-EVENT",
    description: "QEMU Machine Protocol event",
  },
};

const COMPONENT_LABELS = {
  qemu: "QEMU",
  qmp: "QMP",
  vm: "VM",
  console: "CONSOLE",
  storage: "STORAGE",
  network: "NETWORK",
  firmware: "FIRMWARE",
  boot: "BOOT",
  host: "HOST",
};

const SEVERITY_OPTIONS = [
  ["all", "All severities"],
  ["debug", "Debug"],
  ["info", "Info"],
  ["warn", "Warning"],
  ["error", "Error"],
];

const COMPONENT_OPTIONS = [
  ["all", "All components"],
  ...Object.entries(COMPONENT_LABELS).map(([value, label]) => [value, label]),
];

const SOURCE_OPTIONS = [
  ["all", "All sources"],
  ["application", "Wave VM events"],
  ["qemu_stdout", "QEMU stdout"],
  ["qemu_stderr", "QEMU stderr"],
  ["qmp_event", "QMP events"],
];

const fullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function outcomeMeta(outcome) {
  return (
    OUTCOME_META[outcome] || {
      label: String(outcome || "Unknown"),
      tone: "neutral",
      description: "The termination outcome is not recognized.",
    }
  );
}

function severityMeta(severity) {
  return (
    SEVERITY_META[severity] || {
      label: String(severity || "INFO").toUpperCase(),
      tone: "neutral",
      description: "",
    }
  );
}

function sourceMeta(source) {
  return (
    SOURCE_META[source] || {
      label: String(source || "OUTPUT").toUpperCase(),
      description: "",
    }
  );
}

function componentLabel(component) {
  return COMPONENT_LABELS[component] || String(component || "").toUpperCase();
}

function formatFullTimestamp(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "Unknown time";
  }

  return fullTimestampFormatter.format(new Date(timestampMs));
}

function formatEntryTime(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "--:--:--";
  }

  const date = new Date(timestampMs);
  return `${clockFormatter.format(date)}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function formatDuration(startedAt, endedAt) {
  const start = Number.isFinite(startedAt) ? startedAt : 0;
  const end = Number.isFinite(endedAt) && endedAt > 0 ? endedAt : Date.now();
  const elapsed = Math.max(0, end - start);

  if (elapsed < 1000) {
    return `${Math.round(elapsed)} ms`;
  }

  const totalSeconds = Math.round(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatCopyTimestamp(timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "unknown-time";
  }

  return new Date(timestampMs).toISOString();
}

function clipboardLine(entry) {
  return `[${formatCopyTimestamp(entry.timestampMs)}] [${severityMeta(
    entry.severity,
  ).label}] [${componentLabel(entry.component)}] [${sourceMeta(
    entry.source,
  ).label}] ${entry.message}`;
}

async function writeClipboard(value) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to a temporary textarea below.
    }
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();

  let copied = false;

  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  area.remove();
  return copied;
}

export function createVmLogsPage({ store, setPageHeader }, id) {
  let current = store.getState();
  let destroyed = false;
  let view = null;
  let loading = false;
  let loadError = null;
  let selectedSessionId = null;
  let loadGeneration = 0;
  let headerKey = "";
  let notice = null;
  let pollTimer = null;
  let finalRefreshTimer = null;
  let wasVmActive = false;
  let lastEntriesKey = "";
  let lastFilterKey = "";
  let lastSessionOptionsKey = "";
  let alertsKey = "";
  const busy = { copy: false, export: false };
  const filters = {
    severity: "all",
    component: "all",
    source: "all",
    query: "",
  };

  const alerts = createAlertStack();
  const stateRegion = element("div", { className: "vm-logs-state" });

  const sessionSelect = element("select", {
    className: "vm-logs-select",
    attrs: { "aria-label": "Diagnostic session" },
  });
  sessionSelect.addEventListener("change", () => {
    selectedSessionId = sessionSelect.value || null;
    notice = null;
    load({ sessionId: selectedSessionId });
  });

  const summaryBody = element("div", { className: "vm-logs-summary" });
  const summaryPanel = createPanel({
    title: "Session summary",
    description:
      "Termination details, timestamps, and the location of this QEMU diagnostic session.",
    actions: [sessionSelect],
    body: [summaryBody],
  });

  const severitySelect = createFilterSelect(
    SEVERITY_OPTIONS,
    filters.severity,
    "Filter by severity",
    (value) => {
      filters.severity = value;
      renderEntries();
    },
  );
  const componentSelect = createFilterSelect(
    COMPONENT_OPTIONS,
    filters.component,
    "Filter by component",
    (value) => {
      filters.component = value;
      renderEntries();
    },
  );
  const sourceSelect = createFilterSelect(
    SOURCE_OPTIONS,
    filters.source,
    "Filter by source",
    (value) => {
      filters.source = value;
      renderEntries();
    },
  );
  const searchInput = element("input", {
    className: "vm-logs-search",
    attrs: {
      type: "search",
      placeholder: "Filter messages…",
      "aria-label": "Filter log messages",
    },
  });
  searchInput.addEventListener("input", () => {
    filters.query = searchInput.value;
    renderEntries();
  });

  const resetFiltersButton = button({
    label: "Reset",
    variant: "ghost",
    small: true,
    onClick: resetFilters,
  });

  const filterBar = element("div", {
    className: "vm-logs-filters",
    children: [
      filterField("Severity", severitySelect),
      filterField("Component", componentSelect),
      filterField("Source", sourceSelect),
      filterField("Message", searchInput),
      element("div", {
        className: "vm-logs-filter vm-logs-filter-action",
        children: [resetFiltersButton],
      }),
    ],
  });

  const entryCount = element("p", { className: "vm-logs-count" });
  const copyButton = button({
    label: "Copy filtered",
    iconName: "log",
    small: true,
    onClick: copyVisible,
    title: "Copy the log entries currently visible after filtering.",
  });
  const exportButton = button({
    label: "Export log…",
    iconName: "download",
    small: true,
    onClick: exportLog,
    title: "Save the complete log file for the selected session.",
  });

  const entriesRegion = element("div", {
    className: "vm-logs-entries",
    attrs: { role: "log", "aria-label": "Diagnostic entries" },
  });

  const entriesPanel = createPanel({
    title: "Diagnostic entries",
    description:
      "Wave VM events, QMP events, and raw QEMU output in chronological order.",
    actions: [copyButton, exportButton],
    body: [
      filterBar,
      element("div", {
        className: "vm-logs-list-header",
        children: [entryCount],
      }),
      entriesRegion,
    ],
    wide: true,
  });

  const content = element("div", {
    className: "vm-logs-content",
    children: [summaryPanel, entriesPanel],
  });

  const page = element("div", {
    className: "page-stack vm-logs-page",
    children: [alerts, stateRegion, content],
  });

  function findVm(state) {
    return state.vms.find((vm) => vm.id === id) || null;
  }

  function backLink() {
    return buttonLink({
      label: "Back to machine",
      href: `#/machines/${encodeURIComponent(id)}`,
      iconName: "arrowLeft",
      variant: "ghost",
      small: true,
    });
  }

  function machinesLink() {
    return buttonLink({
      label: "Back to machines",
      href: "#/machines",
      iconName: "arrowLeft",
      variant: "ghost",
      small: true,
    });
  }

  function openConsoleLink(vm) {
    return buttonLink({
      label: "Open console",
      href: `#/machines/${encodeURIComponent(vm.id)}/console`,
      iconName: "machines",
      small: true,
    });
  }

  function selectedSession() {
    if (!view) {
      return null;
    }

    return (
      view.sessions.find(
        (session) => session.sessionId === view.selectedSessionId,
      ) || null
    );
  }

  function isVmActive(vm) {
    return Boolean(vm && ACTIVE_STATES.has(vm.state));
  }

  function filterEntries(entries) {
    const query = filters.query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (filters.severity !== "all" && entry.severity !== filters.severity) {
        return false;
      }

      if (filters.component !== "all" && entry.component !== filters.component) {
        return false;
      }

      if (filters.source !== "all" && entry.source !== filters.source) {
        return false;
      }

      if (query && !String(entry.message || "").toLowerCase().includes(query)) {
        return false;
      }

      return true;
    });
  }

  function currentFilteredEntries() {
    return filterEntries(view?.entries || []);
  }

  function resetFilters() {
    filters.severity = "all";
    filters.component = "all";
    filters.source = "all";
    filters.query = "";
    severitySelect.value = "all";
    componentSelect.value = "all";
    sourceSelect.value = "all";
    searchInput.value = "";
    renderEntries();
  }

  function renderStateRegion(state, vm) {
    stateRegion.replaceChildren();
    const showContent = Boolean(vm && view && view.sessions.length > 0);
    content.hidden = !showContent;

    if (showContent) {
      return;
    }

    if (!vm) {
      if (state.vmsStatus === "loading" && state.vms.length === 0) {
        stateRegion.append(skeletonGrid(2));
        return;
      }

      if (state.vmsStatus === "error" && state.vms.length === 0) {
        stateRegion.append(
          createErrorCard({
            title: "Machine details could not be loaded",
            message:
              state.vmsError?.message ||
              "The backend did not return the machine list.",
            code: state.vmsError?.code,
            onRetry: () => store.refreshVms(),
          }),
        );
        return;
      }

      stateRegion.append(
        createEmptyState({
          eyebrow: "Not found",
          title: "Machine not found",
          description:
            "This machine is not present in the local configuration. It may have been removed outside Wave VM.",
          art: false,
          actions: [machinesLink()],
        }),
      );
      return;
    }

    if (loading && !view) {
      stateRegion.append(skeletonGrid(2));
      return;
    }

    if (loadError && !view) {
      stateRegion.append(
        createErrorCard({
          title: "Diagnostic logs could not be loaded",
          message: loadError.message,
          code: loadError.code,
          onRetry: () => load(),
        }),
      );
      return;
    }

    if (view && view.sessions.length === 0) {
      stateRegion.append(
        createEmptyState({
          eyebrow: "No logs yet",
          title: "No diagnostic sessions have been recorded.",
          description: `Start ${vm.name} to create a QEMU diagnostic session. Wave VM keeps previous sessions after the process exits and the application restarts.`,
          art: false,
          actions: [backLink()],
        }),
      );
      return;
    }

    stateRegion.append(skeletonGrid(2));
  }

  function renderSummary(vm) {
    const sessions = view?.sessions || [];

    if (sessions.length === 0) {
      lastSessionOptionsKey = "";
      sessionSelect.replaceChildren();
      sessionSelect.append(
        element("option", { text: "No sessions", attrs: { value: "" } }),
      );
      sessionSelect.disabled = true;
      summaryBody.replaceChildren(
        logMessage(
          "No diagnostic session",
          "No log file is available for this machine yet.",
        ),
      );
      return;
    }

    const optionsKey = JSON.stringify(
      sessions.map((session) => [
        session.sessionId,
        session.startedAtUnixMs,
        session.endedAtUnixMs,
        session.outcome,
        session.isCurrent,
      ]),
    );

    if (optionsKey !== lastSessionOptionsKey) {
      lastSessionOptionsKey = optionsKey;
      sessionSelect.replaceChildren();

      for (const session of sessions) {
        const meta = outcomeMeta(session.outcome);
        const label = `${formatFullTimestamp(session.startedAtUnixMs)} · ${
          meta.label
        }${session.isCurrent ? " · current" : ""}`;
        sessionSelect.append(
          element("option", {
            text: label,
            attrs: { value: session.sessionId },
          }),
        );
      }
    }

    sessionSelect.disabled = false;

    const desiredSessionId = view?.selectedSessionId || sessions[0].sessionId;

    if (sessionSelect.value !== desiredSessionId) {
      sessionSelect.value = desiredSessionId;
    }

    const session = selectedSession();

    if (!session) {
      summaryBody.replaceChildren(
        logMessage(
          "No diagnostic session selected",
          "Choose a session from the selector above.",
        ),
      );
      return;
    }

    const meta = outcomeMeta(session.outcome);
    const endedAt = session.endedAtUnixMs;
    const summaryTone =
      meta.tone === "error" ? "is-error" : meta.tone === "warn" ? "is-warn" : "";

    summaryBody.replaceChildren(
      element("div", {
        className: "vm-logs-summary-head",
        children: [
          statusIndicator({
            label: meta.label,
            tone: meta.tone,
            title: session.summary || meta.description,
          }),
          statusIndicator({
            label: vmStateLabel(vm.state),
            tone: vmStateTone(vm.state),
            title: "Current machine state in Wave VM.",
          }),
          element("span", {
            className: "vm-logs-summary-note-text",
            text: session.isCurrent
              ? "This session is active and refreshes automatically."
              : "This session has ended and is preserved for review.",
          }),
        ],
      }),
      createDetailList([
        { label: "Session ID", value: session.sessionId, code: true },
        { label: "Started", value: formatFullTimestamp(session.startedAtUnixMs) },
        {
          label: "Ended",
          value: endedAt
            ? formatFullTimestamp(endedAt)
            : session.isCurrent
              ? "In progress"
              : "Not recorded",
          muted: !endedAt,
        },
        {
          label: "Duration",
          value: formatDuration(session.startedAtUnixMs, endedAt),
        },
        {
          label: "Exit code",
          value:
            session.exitCode === null || session.exitCode === undefined
              ? "Not reported"
              : String(session.exitCode),
          muted: session.exitCode === null || session.exitCode === undefined,
        },
        {
          label: "Signal",
          value:
            session.signal === null || session.signal === undefined
              ? "None"
              : String(session.signal),
          muted: session.signal === null || session.signal === undefined,
        },
        { label: "Log size", value: formatBytes(session.sizeBytes) },
        { label: "Log file", value: session.logPath, code: true },
        { label: "Log directory", value: view.logDirectory, code: true },
      ]),
      element("p", {
        className: `vm-logs-summary-note ${summaryTone}`.trim(),
        text: session.summary || meta.description,
      }),
      element("p", {
        className: "vm-logs-summary-help",
        text: "Guest panic is reported only when QEMU emits GUEST_PANICKED. A non-zero QEMU exit is classified as a process failure or unexpected exit, not automatically as a guest OS crash. Raw QEMU output is capped per session; when the cap is reached, Wave VM records a warning and suppresses further raw lines. Times are shown in your local time zone; the log file stores UTC timestamps.",
      }),
    );
  }

  function renderEntries() {
    const session = selectedSession();
    const allEntries = view?.entries || [];
    const filtered = filterEntries(allEntries);

    copyButton.disabled = busy.copy || filtered.length === 0;
    exportButton.disabled = busy.export || !session;
    resetFiltersButton.disabled =
      filters.severity === "all" &&
      filters.component === "all" &&
      filters.source === "all" &&
      filters.query === "";

    if (!session) {
      entryCount.textContent = "No session selected";
    } else if (filtered.length === allEntries.length) {
      entryCount.textContent = `${formatCount(allEntries.length)} ${
        allEntries.length === 1 ? "entry" : "entries"
      }`;
    } else {
      entryCount.textContent = `${formatCount(filtered.length)} of ${formatCount(
        allEntries.length,
      )} entries match the current filters`;
    }

    const filterKey = `${filters.severity}|${filters.component}|${filters.source}|${filters.query}`;
    const filterChanged = filterKey !== lastFilterKey;
    lastFilterKey = filterKey;

    const first = filtered[0] || null;
    const last = filtered[filtered.length - 1] || null;
    const key = JSON.stringify([
      view?.selectedSessionId,
      filterKey,
      allEntries.length,
      filtered.length,
      first?.timestampMs,
      first?.message,
      last?.timestampMs,
      last?.message,
    ]);

    if (key === lastEntriesKey) {
      return;
    }

    lastEntriesKey = key;

    const nearBottom =
      entriesRegion.scrollTop + entriesRegion.clientHeight >=
      entriesRegion.scrollHeight - 24;
    const previousScrollTop = entriesRegion.scrollTop;
    entriesRegion.replaceChildren();

    if (!session) {
      entriesRegion.append(
        logMessage(
          "No diagnostic session selected",
          "Choose a session to view its entries.",
        ),
      );
      return;
    }

    if (allEntries.length === 0) {
      entriesRegion.append(
        logMessage(
          session.isCurrent
            ? "Waiting for diagnostic output"
            : "No entries in this session",
          session.isCurrent
            ? "The session is active. QEMU output and Wave VM events will appear here as they are recorded."
            : "This session ended without recording any diagnostic entries.",
        ),
      );
      return;
    }

    if (filtered.length === 0) {
      entriesRegion.append(
        logMessage(
          "No entries match the current filters",
          "Change the severity, component, source, or message filter to show more entries.",
        ),
      );
      return;
    }

    entriesRegion.append(...filtered.map(entryRow));

    if (filterChanged) {
      entriesRegion.scrollTop = 0;
    } else if (nearBottom) {
      entriesRegion.scrollTop = entriesRegion.scrollHeight;
    } else {
      entriesRegion.scrollTop = previousScrollTop;
    }
  }

  function entryRow(entry) {
    const severity = severityMeta(entry.severity);
    const source = sourceMeta(entry.source);
    const raw = entry.source !== "application";

    return element("div", {
      className: raw ? "vm-log-entry is-raw" : "vm-log-entry",
      attrs: {
        "data-severity": entry.severity,
        "data-source": entry.source,
      },
      children: [
        element("span", {
          className: "vm-log-time",
          text: formatEntryTime(entry.timestampMs),
          attrs: { title: formatFullTimestamp(entry.timestampMs) },
        }),
        element("span", {
          className: "vm-log-level",
          text: severity.label,
          attrs: {
            "data-tone": severity.tone,
            title: severity.description,
          },
        }),
        element("span", {
          className: "vm-log-component",
          text: componentLabel(entry.component),
        }),
        element("span", {
          className: "vm-log-source",
          text: source.label,
          attrs: {
            "data-source": entry.source,
            title: source.description,
          },
        }),
        element("span", {
          className: "vm-log-message",
          text: entry.message || "(empty message)",
        }),
      ],
    });
  }

  function updateHeader(state) {
    const vm = findVm(state);
    const actions = [vm ? backLink() : machinesLink()];

    if (vm && vm.state === "running") {
      actions.push(openConsoleLink(vm));
    }

    actions.push(
      button({
        label: loading ? "Refreshing…" : "Refresh",
        iconName: "refresh",
        small: true,
        disabled: loading,
        onClick: () => load(),
      }),
    );

    let title = "Machine not found";
    let description = "The saved machine could not be found.";

    if (vm) {
      title = `${vm.name} logs`;
      description = `${vmStateLabel(vm.state)} · QEMU diagnostics and termination details`;
    } else if (state.vmsStatus === "loading" && state.vms.length === 0) {
      title = "Machine logs";
      description = "Loading machine diagnostics…";
    } else if (state.vmsStatus === "error" && state.vms.length === 0) {
      title = "Logs unavailable";
      description = "The saved machine could not be loaded.";
    }

    const key = JSON.stringify([title, description, vm?.state, loading]);

    if (key === headerKey) {
      return;
    }

    headerKey = key;
    setPageHeader({
      eyebrow: "Diagnostics",
      title,
      description,
      actions,
    });
  }

  function renderAlerts() {
    const showLoadError = Boolean(loadError && view);
    const key = JSON.stringify([
      showLoadError,
      showLoadError ? loadError.message : null,
      showLoadError ? loadError.code : null,
      notice?.severity,
      notice?.title,
      notice?.message,
      notice?.code,
    ]);

    if (key === alertsKey) {
      return;
    }

    alertsKey = key;
    clearAlerts(alerts);

    if (showLoadError) {
      appendAlert(alerts, {
        severity: "warning",
        title: "Diagnostic logs could not be refreshed",
        message: loadError.message,
        code: loadError.code,
      });
    }

    if (notice) {
      appendAlert(alerts, notice);
    }
  }

  function updateAutoRefresh(vm) {
    const session = selectedSession();
    const active = isVmActive(vm);
    const viewingCurrent = !session || session.isCurrent;

    if (active && viewingCurrent) {
      startPolling();
    } else {
      stopPolling();
    }

    if (wasVmActive && !active) {
      if (finalRefreshTimer !== null) {
        window.clearTimeout(finalRefreshTimer);
      }

      finalRefreshTimer = window.setTimeout(() => {
        finalRefreshTimer = null;

        if (!destroyed) {
          load({ silent: true });
        }
      }, 400);
    }

    wasVmActive = active;
  }

  function startPolling() {
    if (pollTimer !== null) {
      return;
    }

    pollTimer = window.setInterval(() => {
      if (!document.hidden) {
        load({ silent: true });
      }
    }, LOG_POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer === null) {
      return;
    }

    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function render(state) {
    if (destroyed) {
      return;
    }

    current = state;
    const vm = findVm(state);

    renderAlerts();
    updateHeader(state);
    renderStateRegion(state, vm);

    if (vm && view && view.sessions.length > 0) {
      renderSummary(vm);
      renderEntries();
    }

    updateAutoRefresh(vm);
  }

  async function load({ silent = false, sessionId = selectedSessionId } = {}) {
    if (destroyed) {
      return;
    }

    const generation = ++loadGeneration;

    if (!silent) {
      loading = true;
      loadError = null;
      render(current);
    }

    try {
      const result = await getVmLogs(id, sessionId);

      if (destroyed || generation !== loadGeneration) {
        return;
      }

      view = result;
      selectedSessionId = result.selectedSessionId || null;
      loading = false;
      loadError = null;
    } catch (error) {
      if (destroyed || generation !== loadGeneration) {
        return;
      }

      loading = false;
      loadError = normalizeError(error);
    }

    render(current);
  }

  async function copyVisible() {
    if (busy.copy) {
      return;
    }

    const entries = currentFilteredEntries();

    if (entries.length === 0) {
      return;
    }

    busy.copy = true;
    copyButton.disabled = true;

    const copied = await writeClipboard(entries.map(clipboardLine).join("\n"));

    if (destroyed) {
      return;
    }

    busy.copy = false;
    notice = copied
      ? {
          severity: "info",
          title: "Log entries copied",
          message: `${formatCount(entries.length)} ${
            entries.length === 1 ? "entry was" : "entries were"
          } copied to the clipboard.`,
        }
      : {
          severity: "error",
          title: "Log entries could not be copied",
          message:
            "The clipboard is unavailable in this webview. Use Export log to save the complete session instead.",
        };

    render(current);
  }

  async function exportLog() {
    if (busy.export || !view?.selectedSessionId) {
      return;
    }

    busy.export = true;
    exportButton.disabled = true;

    try {
      const destination = await exportVmLog(id, view.selectedSessionId);

      if (destroyed) {
        return;
      }

      notice = destination
        ? {
            severity: "info",
            title: "Diagnostic log exported",
            message: destination,
          }
        : null;
    } catch (error) {
      if (destroyed) {
        return;
      }

      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Diagnostic log could not be exported",
        message: normalized.message,
        code: normalized.code,
      };
    } finally {
      busy.export = false;

      if (!destroyed) {
        render(current);
      }
    }
  }

  const unsubscribe = store.subscribe(render);
  load();

  return {
    element: page,
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      loadGeneration += 1;
      stopPolling();

      if (finalRefreshTimer !== null) {
        window.clearTimeout(finalRefreshTimer);
        finalRefreshTimer = null;
      }

      unsubscribe();
    },
  };
}

function createFilterSelect(options, value, ariaLabel, onChange) {
  const select = element("select", {
    className: "vm-logs-filter-select",
    attrs: { "aria-label": ariaLabel },
  });

  for (const [optionValue, label] of options) {
    select.append(
      element("option", { text: label, attrs: { value: optionValue } }),
    );
  }

  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function filterField(label, control) {
  return element("label", {
    className: "vm-logs-filter",
    children: [
      element("span", { className: "vm-logs-filter-label", text: label }),
      control,
    ],
  });
}

function logMessage(title, description) {
  return element("div", {
    className: "vm-logs-empty",
    children: [
      element("strong", { text: title }),
      element("p", { text: description }),
    ],
  });
}
