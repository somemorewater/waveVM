import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { buttonLink } from "../../components/button.js";
import { createDetailList } from "../../components/detail-list.js";
import { createEmptyState } from "../../components/empty-state.js";
import { createErrorCard } from "../../components/error-card.js";
import { appendHostWarnings } from "../../components/host-cards.js";
import { createPanel } from "../../components/panel.js";
import { skeletonGrid } from "../../components/skeleton.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { element } from "../../utils/dom.js";
import {
  accelerationLabel,
  formatCount,
  formatDisk,
  formatMemory,
  formatTimestamp,
  vmStateLabel,
  vmStateTone,
} from "../../utils/format.js";
import { createVmActionButtons } from "./vm-action-buttons.js";
import { createVmActionController } from "./vm-actions.js";

export function createVmDetailsPage({ store, setPageHeader }, id) {
  let current = store.getState();
  let notice = null;
  let busyAction = null;
  let headerKey = "";
  let contentKey = "";
  let destroyed = false;

  const alerts = createAlertStack();
  const content = element("div", { className: "vm-details-content" });

  const page = element("div", {
    className: "page-stack",
    children: [alerts, content],
  });

  const actionController = createVmActionController({
    store,
    onChange() {
      busyAction = actionController.busy.get(id) || null;

      if (!destroyed) {
        render(current);
      }
    },
    onNotice(alert) {
      notice = alert;

      if (!destroyed) {
        renderAlerts(current);
      }
    },
  });

  function backLink() {
    return buttonLink({
      label: "Back to machines",
      href: "#/machines",
      iconName: "arrowLeft",
      variant: "ghost",
    });
  }

  function findVm(state) {
    return state.vms.find((vm) => vm.id === id) || null;
  }

  function lifecycleActions(vm) {
    const actions = createVmActionButtons({
      vm,
      busyAction,
      onStart(vmId) {
        const target = current.vms.find((item) => item.id === vmId);
        actionController.start(target);
      },
      onStop(vmId) {
        const target = current.vms.find((item) => item.id === vmId);
        actionController.stop(target);
      },
    });

    if (vm.state === "running") {
      actions.unshift(
        buttonLink({
          label: "Open console",
          href: `#/machines/${vm.id}/console`,
          iconName: "machines",
          small: true,
        }),
      );
    }

    return actions;
  }

  function updateHeader(state) {
    const vm = findVm(state);
    let header;

    if (vm) {
      header = {
        eyebrow: "Machine",
        title: vm.name,
        description: `${vmStateLabel(vm.state)} · ${vm.guestArch || "unknown"} guest`,
        actions: [backLink(), ...lifecycleActions(vm)],
      };
    } else if (state.vmsStatus === "loading" && state.vms.length === 0) {
      header = {
        eyebrow: "Machine",
        title: "Machine details",
        description: "Loading machine details…",
        actions: [backLink()],
      };
    } else {
      header = {
        eyebrow: "Machine",
        title: "Machine not found",
        description: "The saved machine could not be found.",
        actions: [backLink()],
      };
    }

    const key = JSON.stringify([
      header.title,
      header.description,
      busyAction,
      vm?.state,
      vm?.diskExists,
    ]);

    if (key !== headerKey) {
      headerKey = key;
      setPageHeader(header);
    }
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

  function renderContent(state) {
    content.replaceChildren();
    const vm = findVm(state);

    if (!vm) {
      if (state.vmsStatus === "loading" && state.vms.length === 0) {
        content.append(skeletonGrid(2));
        return;
      }

      if (state.vmsStatus === "error" && state.vms.length === 0) {
        content.append(
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

      content.append(
        createEmptyState({
          eyebrow: "Not found",
          title: "Machine not found",
          description:
            "This machine is not present in the local configuration. It may have been removed outside Wave VM.",
          art: false,
          actions: [backLink()],
        }),
      );
      return;
    }

    content.append(detailsGrid(vm), scopeNote());
  }

  function detailsGrid(vm) {
    const overview = createPanel({
      title: "Overview",
      description: "Configuration and live lifecycle state.",
      body: [
        element("div", {
          className: "vm-detail-status",
          children: [
            statusIndicator({
              label: vmStateLabel(vm.state),
              tone: vmStateTone(vm.state),
            }),
            element("span", {
              className: "vm-detail-status-note",
              text: vm.diskExists ? "Virtual disk present" : "Virtual disk missing",
            }),
          ],
        }),
        createDetailList([
          { label: "Name", value: vm.name },
          { label: "Guest architecture", value: vm.guestArch, code: true },
          { label: "Guest OS", value: "Not installed", muted: true },
          { label: "Memory", value: formatMemory(vm.memoryMib) },
          { label: "Virtual CPUs", value: formatCount(vm.vcpus) },
          {
            label: "Acceleration",
            value: vm.acceleration
              ? accelerationLabel(vm.acceleration)
              : "Not running",
          },
          { label: "Created", value: formatTimestamp(vm.createdAtUnix) },
          { label: "Updated", value: formatTimestamp(vm.updatedAtUnix) },
        ]),
        vm.lastError
          ? element("p", {
              className:
                vm.state === "error" ? "vm-card-error" : "vm-card-note",
              text: vm.lastError,
            })
          : null,
      ],
    });

    const storage = createPanel({
      title: "Storage",
      description: "The QCOW2 disk recorded for this machine.",
      body: [
        createDetailList([
          { label: "Disk path", value: vm.diskPath, code: true },
          { label: "Format", value: "QCOW2" },
          { label: "Size", value: formatDisk(vm.diskSizeGib) },
          {
            label: "Availability",
            value: statusIndicator({
              label: vm.diskExists ? "Present" : "Missing",
              tone: vm.diskExists ? "ok" : "error",
            }),
          },
        ]),
        vm.diskExists
          ? null
          : element("p", {
              className: "vm-card-error",
              text: "The disk file is missing. Wave VM will not start this machine until the disk is restored.",
            }),
        element("p", {
          className: "panel-note",
          text: "Disk files are created with the machine. Storage management is not available in this build.",
        }),
      ],
    });

    const lifecycle = createPanel({
      title: "Lifecycle",
      description: "Start and stop actions are available in the page header.",
      wide: true,
      body: [
        element("p", {
          className: "panel-copy",
          text: "Starting launches a real QEMU process. Stopping asks QEMU to shut down through QMP. A machine is shown as running only while its process is alive.",
        }),
        element("p", {
          className: "panel-copy",
          text:
            vm.state === "running"
              ? "The guest display is available in the console view. The console connects to QEMU's loopback-only VNC WebSocket through the bundled noVNC client."
              : "Start the machine to open its guest display in the console view.",
        }),
        vm.state === "running"
          ? buttonLink({
              label: "Open console",
              href: `#/machines/${vm.id}/console`,
              iconName: "machines",
            })
          : null,
        element("p", {
          className: "panel-note",
          text: "Guest operating system installation and installation media are outside this build.",
        }),
      ],
    });

    return element("div", {
      className: "vm-details-grid",
      children: [overview, storage, lifecycle],
    });
  }

  function scopeNote() {
    return element("aside", {
      className: "inline-note",
      children: [
        element("strong", { text: "Not available yet" }),
        element("p", {
          text: "Editing machine configuration, deleting machines, snapshots, networking, and guest OS installation are outside this build.",
        }),
      ],
    });
  }

  function contentKeyFor(state) {
    const vm = findVm(state);

    if (!vm) {
      return `${state.vmsStatus}|${state.vmsError?.code}|${state.vms.length}`;
    }

    return JSON.stringify([
      vm.id,
      vm.name,
      vm.state,
      vm.lastError,
      vm.diskExists,
      vm.acceleration,
      vm.memoryMib,
      vm.vcpus,
      vm.diskSizeGib,
      vm.createdAtUnix,
      vm.updatedAtUnix,
      vm.guestArch,
      vm.diskPath,
    ]);
  }

  function render(state) {
    if (destroyed) {
      return;
    }

    current = state;
    renderAlerts(state);
    updateHeader(state);

    const key = contentKeyFor(state);

    if (key !== contentKey) {
      contentKey = key;
      renderContent(state);
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
