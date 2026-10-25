import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button, buttonLink } from "../../components/button.js";
import { createDetailList } from "../../components/detail-list.js";
import { createEmptyState } from "../../components/empty-state.js";
import { createErrorCard } from "../../components/error-card.js";
import {
  appendHostWarnings,
  renderHostCards,
  renderHostError,
  renderHostLoading,
} from "../../components/host-cards.js";
import { createPanel } from "../../components/panel.js";
import { sectionHeading } from "../../components/section.js";
import { skeletonGrid } from "../../components/skeleton.js";
import { createStatCard } from "../../components/stat-card.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { element } from "../../utils/dom.js";
import {
  formatBytes,
  formatCount,
  formatDisk,
  vmStateLabel,
} from "../../utils/format.js";

export function createStoragePage({ store, setPageHeader }) {
  let current = store.getState();
  let notice = null;
  let destroyed = false;
  let statsKey = "";
  let hostKey = "";
  let diskKey = "";
  let locationsKey = "";

  const alerts = createAlertStack();
  const stats = element("div", { className: "stat-grid" });
  const hostRegion = element("div", { className: "host-panel" });
  const diskRegion = element("div", { className: "storage-disk-region" });
  const locationsRegion = element("div", { className: "storage-locations" });

  const refreshButton = button({
    label: "Refresh",
    iconName: "refresh",
    onClick: () => {
      store.refreshHost();
      store.refreshVms();
    },
  });

  const page = element("div", {
    className: "page-stack",
    children: [
      alerts,
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Overview",
            title: "Local storage",
            description:
              "Disk information is derived from saved machines and the host storage probe.",
          }),
          stats,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Filesystem",
            title: "Application storage",
            description:
              "The filesystem used for Wave VM configuration and virtual disks.",
          }),
          hostRegion,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Disks",
            title: "Virtual disks",
            description:
              "Read-only inventory of the QCOW2 disks recorded in machine definitions.",
          }),
          diskRegion,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Planned",
            title: "Disk management",
            description:
              "These operations are not implemented. No destructive controls are exposed.",
          }),
          createPanel({
            title: "Not available in this build",
            description:
              "Storage remains read-only until disk management is implemented safely.",
            actions: [
              statusIndicator({ label: "Planned", tone: "neutral" }),
            ],
            body: [
              element("ul", {
                className: "scope-list",
                children: [
                  "Resize virtual disks",
                  "Delete disks independently of machine definitions",
                  "Attach existing disks to machines",
                  "Inspect disk usage and compaction",
                ].map((item) => element("li", { text: item })),
              }),
              element("p", {
                className: "panel-note",
                text: "Wave VM will not offer destructive storage actions before they can be implemented and verified safely.",
              }),
            ],
          }),
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Paths",
            title: "Data locations",
            description:
              "Locations are read-only in this build and are managed by the platform application data directory.",
          }),
          locationsRegion,
        ],
      }),
    ],
  });

  setPageHeader({
    eyebrow: "Workspace",
    title: "Storage",
    description:
      "Inspect local virtual disks and the application data filesystem.",
    actions: [refreshButton],
  });

  function renderAlerts(state) {
    clearAlerts(alerts);
    appendHostWarnings(alerts, state.host, state.appInfoError);

    if (state.hostError && state.host) {
      appendAlert(alerts, {
        severity: "warning",
        title: "Host diagnostics could not be refreshed",
        message: state.hostError.message,
        code: state.hostError.code,
      });
    }

    if (state.vmsError) {
      appendAlert(alerts, {
        severity: "error",
        title: "Virtual disks could not be loaded",
        message: state.vmsError.message,
        code: state.vmsError.code,
      });
    }

    if (notice) {
      appendAlert(alerts, notice);
    }
  }

  function renderStats(state) {
    const vmsLoading =
      state.vmsStatus === "loading" && state.vms.length === 0;
    const hostLoading = state.hostStatus === "loading" && !state.host;
    const missing = state.vms.filter((vm) => !vm.diskExists).length;
    const freeBytes = state.host?.storage?.freeBytes;

    stats.replaceChildren(
      createStatCard({
        label: "Virtual disks",
        value: vmsLoading ? "—" : formatCount(state.vms.length),
        detail: vmsLoading
          ? "Loading from the backend…"
          : state.vms.length > 0
            ? "Defined by saved machines"
            : "No disks recorded",
        iconName: "storage",
        tone: "neutral",
        loading: vmsLoading,
      }),
      createStatCard({
        label: "Missing disks",
        value: vmsLoading ? "—" : formatCount(missing),
        detail: vmsLoading
          ? "Loading from the backend…"
          : missing > 0
            ? "Machines with missing disk files"
            : "All recorded disks are present",
        iconName: "warning",
        tone: missing > 0 ? "error" : "neutral",
        loading: vmsLoading,
      }),
      createStatCard({
        label: "Free space",
        value: hostLoading ? "—" : formatBytes(freeBytes),
        detail: hostLoading
          ? "Loading from the backend…"
          : freeBytes === null || freeBytes === undefined
            ? "Storage information unavailable"
            : "Application data filesystem",
        iconName: "folder",
        tone: "neutral",
        loading: hostLoading,
      }),
    );
  }

  function renderHost(state) {
    if (state.hostStatus === "loading" && !state.host) {
      renderHostLoading(hostRegion, 1);
      return;
    }

    if (state.hostStatus === "error" && !state.host) {
      renderHostError(
        hostRegion,
        state.hostError || {
          code: "host_unavailable",
          message: "Host diagnostics did not return data.",
        },
      );
      return;
    }

    if (state.host) {
      renderHostCards(hostRegion, {
        host: state.host,
        appInfo: state.appInfo,
        appInfoError: state.appInfoError,
        include: ["storage"],
      });
    }
  }

  function renderDisks(state) {
    diskRegion.replaceChildren();

    if (state.vmsStatus === "loading" && state.vms.length === 0) {
      diskRegion.append(skeletonGrid(2));
      return;
    }

    if (state.vmsStatus === "error" && state.vms.length === 0) {
      diskRegion.append(
        createErrorCard({
          title: "Virtual disks could not be loaded",
          message:
            state.vmsError?.message ||
            "The backend did not return the machine list.",
          code: state.vmsError?.code,
          onRetry: () => store.refreshVms(),
        }),
      );
      return;
    }

    if (state.vms.length === 0) {
      diskRegion.append(
        createEmptyState({
          eyebrow: "No disks yet",
          title: "No virtual disks yet.",
          description:
            "A virtual disk is created with each machine definition. Create a machine to see its disk here.",
          art: false,
          actions: [
            buttonLink({
              label: "Go to virtual machines",
              href: "#/machines",
            }),
          ],
        }),
      );
      return;
    }

    const rows = state.vms.map((vm) =>
      element("tr", {
        children: [
          element("td", {
            children: [
              element("a", {
                text: vm.name,
                attrs: { href: `#/machines/${encodeURIComponent(vm.id)}` },
              }),
              element("span", {
                className: "table-sub",
                text: vmStateLabel(vm.state),
              }),
            ],
          }),
          element("td", {
            children: [element("code", { text: vm.diskPath })],
          }),
          element("td", { text: formatDisk(vm.diskSizeGib) }),
          element("td", {
            children: [
              statusIndicator({
                label: vm.diskExists ? "Present" : "Missing",
                tone: vm.diskExists ? "ok" : "error",
              }),
            ],
          }),
        ],
      }),
    );

    diskRegion.append(
      element("div", {
        className: "table-scroll",
        children: [
          element("table", {
            className: "data-table",
            children: [
              element("thead", {
                children: [
                  element("tr", {
                    children: [
                      element("th", { text: "Machine" }),
                      element("th", { text: "Disk path" }),
                      element("th", { text: "Size" }),
                      element("th", { text: "Availability" }),
                    ],
                  }),
                ],
              }),
              element("tbody", { children: rows }),
            ],
          }),
        ],
      }),
    );
  }

  function renderLocations(state) {
    locationsRegion.replaceChildren();

    if (state.appInfoStatus === "loading" && !state.appInfo) {
      locationsRegion.append(skeletonGrid(1));
      return;
    }

    if (state.appInfoError && !state.appInfo) {
      locationsRegion.append(
        createErrorCard({
          title: "Local data locations could not be loaded",
          message: state.appInfoError.message,
          code: state.appInfoError.code,
          onRetry: () => store.refreshHost(),
        }),
      );
      return;
    }

    if (!state.appInfo) {
      locationsRegion.append(
        element("p", {
          className: "panel-note",
          text: "Local data locations were not returned by the backend.",
        }),
      );
      return;
    }

    locationsRegion.append(
      createPanel({
        title: "Application data",
        description: "Paths reported by the Rust backend.",
        body: [
          createDetailList([
            { label: "Data directory", value: state.appInfo.dataDir, code: true },
            { label: "VM directory", value: state.appInfo.vmsDir, code: true },
            {
              label: "Configuration",
              value: state.appInfo.configPath,
              code: true,
            },
          ]),
          element("p", {
            className: "panel-note",
            text: "These paths are not configurable in this build. Wave VM uses the platform application data directory.",
          }),
        ],
      }),
    );
  }

  function updateRefreshButton(state) {
    const loading =
      state.hostStatus === "loading" || state.vmsStatus === "loading";
    refreshButton.disabled = loading;
    const label = refreshButton.querySelector("span");
    if (label) {
      label.textContent = loading ? "Refreshing…" : "Refresh";
    }
  }

  function render(state) {
    if (destroyed) {
      return;
    }

    current = state;
    renderAlerts(state);
    updateRefreshButton(state);

    const nextStatsKey = [
      state.vmsStatus,
      state.vms.length,
      state.vms.filter((vm) => !vm.diskExists).length,
      state.hostStatus,
      state.host?.storage?.freeBytes,
    ].join("|");

    if (nextStatsKey !== statsKey) {
      statsKey = nextStatsKey;
      renderStats(state);
    }

    const nextHostKey = [
      state.hostStatus,
      state.host?.collectedAtUnix,
      state.hostError?.code,
      JSON.stringify(state.host?.warnings || []),
    ].join("|");

    if (nextHostKey !== hostKey) {
      hostKey = nextHostKey;
      renderHost(state);
    }

    const nextDiskKey = JSON.stringify([
      state.vmsStatus,
      state.vmsError?.code,
      state.vms.map((vm) => [
        vm.id,
        vm.name,
        vm.state,
        vm.diskPath,
        vm.diskSizeGib,
        vm.diskExists,
      ]),
    ]);

    if (nextDiskKey !== diskKey) {
      diskKey = nextDiskKey;
      renderDisks(state);
    }

    const nextLocationsKey = [
      state.appInfoStatus,
      state.appInfo?.dataDir,
      state.appInfo?.vmsDir,
      state.appInfo?.configPath,
      state.appInfoError?.code,
    ].join("|");

    if (nextLocationsKey !== locationsKey) {
      locationsKey = nextLocationsKey;
      renderLocations(state);
    }
  }

  const unsubscribe = store.subscribe(render);

  return {
    element: page,
    destroy() {
      destroyed = true;
      unsubscribe();
    },
  };
}
