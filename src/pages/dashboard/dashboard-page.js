import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button, buttonLink } from "../../components/button.js";
import { createEmptyState } from "../../components/empty-state.js";
import { createErrorCard } from "../../components/error-card.js";
import {
  appendHostWarnings,
  renderHostCards,
  renderHostError,
  renderHostLoading,
} from "../../components/host-cards.js";
import { icon } from "../../components/icons.js";
import { sectionHeading } from "../../components/section.js";
import { skeletonGrid } from "../../components/skeleton.js";
import { createStatCard } from "../../components/stat-card.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { element } from "../../utils/dom.js";
import {
  formatCount,
  formatDisk,
  formatRelativeTime,
  vmStateLabel,
  vmStateTone,
} from "../../utils/format.js";
import { openCreateVmDialog } from "../virtual-machines/create-vm-dialog.js";

export function createDashboardPage({ store, setPageHeader }) {
  let current = store.getState();
  let notice = null;
  let activeDialog = null;
  let lastRecentKey = null;
  let lastHostKey = null;
  let destroyed = false;

  const alerts = createAlertStack();
  const stats = element("div", { className: "stat-grid" });
  const recentRegion = element("div", { className: "dashboard-recent-region" });
  const hostRegion = element("div", { className: "host-panel" });

  const refreshButton = button({
    label: "Refresh",
    iconName: "refresh",
    onClick: () => {
      store.refreshHost();
      store.refreshVms();
    },
  });
  const createButton = button({
    label: "New machine",
    iconName: "plus",
    variant: "primary",
    onClick: openCreate,
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
            title: "At a glance",
            description:
              "Counts come from the saved machine definitions returned by the backend.",
          }),
          stats,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Machines",
            title: "Recent machines",
            description:
              "The machines updated most recently in the local configuration.",
            actions: [
              buttonLink({
                label: "View all",
                href: "#/machines",
                variant: "ghost",
                small: true,
              }),
            ],
          }),
          recentRegion,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Environment",
            title: "Host readiness",
            description:
              "QEMU, KVM, and storage values come from the Rust host probe.",
          }),
          hostRegion,
        ],
      }),
      element("aside", {
        className: "inline-note",
        children: [
          element("strong", { text: "Build scope" }),
          element("p", {
            text: "Attach a local ISO to a stopped machine from its details or the Installation media page. Running machines can be opened in the console view.",
          }),
        ],
      }),
    ],
  });

  setPageHeader({
    eyebrow: "Workspace",
    title: "Dashboard",
    description: "Your local virtualization workspace at a glance.",
    actions: [refreshButton, createButton],
  });

  function openCreate() {
    if (activeDialog) {
      return;
    }

    activeDialog = openCreateVmDialog({
      store,
      onCreated(vm) {
        notice = {
          severity: "info",
          title: "Machine created",
          message: `${vm.name} is configured with a ${formatDisk(
            vm.diskSizeGib,
          )} QCOW2 disk. Start it when you are ready.`,
        };
        renderAlerts(store.getState());
      },
      onClose() {
        activeDialog = null;
      },
    });
  }

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
        title: "Machines could not be loaded",
        message: state.vmsError.message,
        code: state.vmsError.code,
      });
    }

    if (notice) {
      appendAlert(alerts, notice);
    }
  }

  function renderStats(state) {
    const loading = state.vmsStatus === "loading" && state.vms.length === 0;
    const unavailable =
      state.vmsStatus === "error" && state.vms.length === 0;
    const running = state.vms.filter((vm) => vm.state === "running").length;
    const stopped = state.vms.filter((vm) => vm.state === "stopped").length;
    const attention = state.vms.filter(
      (vm) => vm.state === "error" || !vm.diskExists,
    ).length;
    const total = state.vms.length;

    stats.replaceChildren(
      createStatCard({
        label: "Running now",
        value: unavailable ? "—" : formatCount(running),
        detail: unavailable
          ? "Machine data unavailable"
          : loading
            ? "Loading from the backend…"
            : running > 0
              ? "Live QEMU processes"
              : "No machines running",
        iconName: "play",
        tone: running > 0 ? "ok" : "neutral",
        loading,
      }),
      createStatCard({
        label: "Stopped",
        value: unavailable ? "—" : formatCount(stopped),
        detail: unavailable
          ? "Machine data unavailable"
          : loading
            ? "Loading from the backend…"
            : stopped > 0
              ? "Configured but not running"
              : "None stopped",
        iconName: "stop",
        tone: "neutral",
        loading,
      }),
      createStatCard({
        label: "Configured",
        value: unavailable ? "—" : formatCount(total),
        detail: unavailable
          ? "Machine data unavailable"
          : loading
            ? "Loading from the backend…"
            : attention > 0
              ? `${formatCount(attention)} need attention`
              : total > 0
                ? "Saved in local configuration"
                : "No machines saved",
        iconName: "machines",
        tone: attention > 0 ? "warn" : "neutral",
        loading,
      }),
    );
  }

  function renderRecent(state) {
    const loading = state.vmsStatus === "loading" && state.vms.length === 0;

    if (loading) {
      recentRegion.replaceChildren(skeletonGrid(2));
      return;
    }

    if (state.vmsStatus === "error" && state.vms.length === 0) {
      recentRegion.replaceChildren(
        createErrorCard({
          title: "Machines could not be loaded",
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
      recentRegion.replaceChildren(
        createEmptyState({
          eyebrow: "No machines yet",
          title: "Create your first machine.",
          description:
            "Choose a name, memory, CPU count, and disk size, optionally attach a local ISO, and Wave VM creates the QCOW2 disk and manages the real QEMU process.",
          facts: [
            "Real QEMU lifecycle",
            "Local QCOW2 disks",
            "No account required",
          ],
          actions: [
            button({
              label: "New machine",
              iconName: "plus",
              variant: "primary",
              onClick: openCreate,
            }),
          ],
        }),
      );
      return;
    }

    const recent = [...state.vms]
      .sort(
        (left, right) =>
          (right.updatedAtUnix || right.createdAtUnix || 0) -
          (left.updatedAtUnix || left.createdAtUnix || 0),
      )
      .slice(0, 3);

    recentRegion.replaceChildren(
      element("div", {
        className: "recent-list",
        children: recent.map((vm) =>
          element("a", {
            className: "recent-item",
            attrs: { href: `#/machines/${encodeURIComponent(vm.id)}` },
            children: [
              element("div", {
                className: "recent-item-main",
                children: [
                  element("h3", {
                    className: "recent-name",
                    text: vm.name,
                  }),
                  element("p", {
                    className: "recent-meta",
                    children: [
                      element("span", {
                        text: `${formatCount(vm.memoryMib)} MiB memory`,
                      }),
                      element("span", {
                        text: `${formatCount(vm.vcpus)} vCPUs`,
                      }),
                      element("span", {
                        text: `${formatCount(vm.diskSizeGib)} GiB disk`,
                      }),
                    ],
                  }),
                ],
              }),
              element("div", {
                className: "recent-side",
                children: [
                  statusIndicator({
                    label: vmStateLabel(vm.state),
                    tone: vmStateTone(vm.state),
                  }),
                  element("span", {
                    className: "recent-updated",
                    text: formatRelativeTime(
                      vm.updatedAtUnix || vm.createdAtUnix,
                    ),
                  }),
                  icon("arrowRight", 16, "recent-chevron"),
                ],
              }),
            ],
          }),
        ),
      }),
    );
  }

  function renderHost(state) {
    if (state.hostStatus === "loading" && !state.host) {
      renderHostLoading(hostRegion, 4);
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
        include: ["system", "kvm", "qemu", "storage"],
      });
    }
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
    renderStats(state);
    updateRefreshButton(state);

    const recentKey = JSON.stringify([
      state.vmsStatus,
      state.vmsError?.code,
      state.vms.map((vm) => [
        vm.id,
        vm.name,
        vm.state,
        vm.diskExists,
        vm.memoryMib,
        vm.vcpus,
        vm.diskSizeGib,
        vm.updatedAtUnix,
      ]),
    ]);

    if (recentKey !== lastRecentKey) {
      lastRecentKey = recentKey;
      renderRecent(state);
    }

    const hostKey = [
      state.hostStatus,
      state.host?.collectedAtUnix,
      state.appInfoError?.code,
      state.hostError?.code,
      JSON.stringify(state.host?.warnings || []),
    ].join("|");

    if (hostKey !== lastHostKey) {
      lastHostKey = hostKey;
      renderHost(state);
    }
  }

  const unsubscribe = store.subscribe(render);

  return {
    element: page,
    destroy() {
      destroyed = true;
      unsubscribe();
      activeDialog?.forceClose?.("navigation");
      activeDialog = null;
    },
  };
}
