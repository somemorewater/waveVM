import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button } from "../../components/button.js";
import { createEmptyState } from "../../components/empty-state.js";
import { createErrorCard } from "../../components/error-card.js";
import { appendHostWarnings } from "../../components/host-cards.js";
import { sectionHeading } from "../../components/section.js";
import { skeletonGrid } from "../../components/skeleton.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { element } from "../../utils/dom.js";
import { formatCount, formatDisk } from "../../utils/format.js";
import { openCreateVmDialog } from "./create-vm-dialog.js";
import { createVmActionController } from "./vm-actions.js";
import { createVmCard } from "./vm-card.js";

export function createVirtualMachinesPage({ store, setPageHeader }) {
  let current = store.getState();
  let notice = null;
  let activeDialog = null;
  let lastListKey = null;
  let destroyed = false;

  const alerts = createAlertStack();
  const summary = element("div", { className: "vm-summary" });
  const listRegion = element("div", { className: "vm-list-region" });

  const actionController = createVmActionController({
    store,
    onChange() {
      if (!destroyed) {
        renderList(current);
      }
    },
    onNotice(alert) {
      if (!destroyed) {
        notice = alert;
        renderAlerts(current);
      }
    },
  });

  const refreshButton = button({
    label: "Refresh",
    iconName: "refresh",
    onClick: () => store.refreshVms(),
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
            eyebrow: "Library",
            title: "Saved machines",
            description:
              "Only machines in the local configuration are shown. A machine is running only while its QEMU process is alive.",
            actions: [summary],
          }),
          listRegion,
        ],
      }),
      element("aside", {
        className: "inline-note",
        children: [
          element("strong", { text: "Current scope" }),
          element("p", {
            text: "New machines use NAT networking by default, and installation media or networking can be changed on a stopped machine. Image downloads, bridged networking, editing other configuration, deletion, and snapshots are not available in this build.",
          }),
        ],
      }),
    ],
  });

  setPageHeader({
    eyebrow: "Workspace",
    title: "Virtual machines",
    description:
      "Create local machines and control their real QEMU lifecycle.",
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
          message: vm.installIsoPath
            ? `${vm.name} is configured with a ${formatDisk(
                vm.diskSizeGib,
              )} QCOW2 disk and will boot its installer ISO on first start.`
            : `${vm.name} is configured with a ${formatDisk(
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

  function summarize(state) {
    if (state.vmsStatus === "loading" && state.vms.length === 0) {
      return { label: "Loading machines", tone: "neutral" };
    }

    if (state.vmsStatus === "error" && state.vms.length === 0) {
      return { label: "Machines unavailable", tone: "error" };
    }

    const count = state.vms.length;

    if (count === 0) {
      return { label: "No machines", tone: "neutral" };
    }

    const running = state.vms.filter((vm) => vm.state === "running").length;
    const attention = state.vms.some(
      (vm) => vm.state === "error" || !vm.diskExists,
    );

    if (attention) {
      return {
        label: `${formatCount(count)} machines · attention needed`,
        tone: "error",
      };
    }

    if (running > 0) {
      return {
        label: `${formatCount(count)} machines · ${formatCount(
          running,
        )} running`,
        tone: "ok",
      };
    }

    return {
      label: `${formatCount(count)} machines · none running`,
      tone: "neutral",
    };
  }

  function listKey(state) {
    return JSON.stringify([
      state.vmsStatus,
      state.vmsError?.code,
      state.vms.map((vm) => [
        vm.id,
        vm.name,
        vm.state,
        vm.lastError,
        vm.diskExists,
        vm.acceleration,
        vm.memoryMib,
        vm.vcpus,
        vm.diskSizeGib,
        vm.installIsoPath,
        vm.installIsoAvailable,
        vm.bootMode,
        vm.network?.enabled,
        vm.network?.mode,
        vm.network?.adapter,
        vm.updatedAtUnix,
      ]),
    ]);
  }

  function renderList(state) {
    listRegion.replaceChildren();

    if (state.vmsStatus === "loading" && state.vms.length === 0) {
      listRegion.append(skeletonGrid(2));
      return;
    }

    if (state.vmsStatus === "error" && state.vms.length === 0) {
      listRegion.append(
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
      listRegion.append(
        createEmptyState({
          eyebrow: "No machines yet",
          title: "Create your first machine.",
          description:
            "Choose a name, memory, CPU count, and disk size. Wave VM creates the QCOW2 disk and manages the real QEMU process. No operating system is installed yet.",
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

    listRegion.append(
      element("div", {
        className: "vm-grid",
        children: state.vms.map((vm) =>
          createVmCard({
            vm,
            busyAction: actionController.busy.get(vm.id) || null,
            onStart: (id) => {
              const target = current.vms.find((item) => item.id === id);
              actionController.start(target);
            },
            onStop: (id) => {
              const target = current.vms.find((item) => item.id === id);
              actionController.stop(target);
            },
          }),
        ),
      }),
    );
  }

  function updateRefreshButton(state) {
    const loading = state.vmsStatus === "loading";
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
    summary.replaceChildren(statusIndicator(summarize(state)));
    updateRefreshButton(state);

    const key = listKey(state);

    if (key !== lastListKey) {
      lastListKey = key;
      renderList(state);
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
