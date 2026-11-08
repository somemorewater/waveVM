import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button, buttonLink } from "../../components/button.js";
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
  bootModeLabel,
  fileName,
  formatCount,
  formatDisk,
  formatMemory,
  formatTimestamp,
  networkAdapterLabel,
  networkModeLabel,
  vmStateLabel,
  vmStateTone,
} from "../../utils/format.js";
import { normalizeError } from "../../services/tauri.js";
import { pickIsoFile } from "../../services/vm-service.js";
import { createVmActionButtons } from "./vm-action-buttons.js";
import { createVmActionController } from "./vm-actions.js";

export function createVmDetailsPage({ store, setPageHeader }, id) {
  let current = store.getState();
  let notice = null;
  let busyAction = null;
  let mediaBusy = null;
  let networkBusy = null;
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

  function mediaEditable(vm) {
    return Boolean(
      vm && !["starting", "running", "stopping"].includes(vm.state),
    );
  }

  function networkEditable(vm) {
    return Boolean(
      vm && !["starting", "running", "stopping"].includes(vm.state),
    );
  }

  function networkConfig(vm) {
    return vm.network || { enabled: true, mode: "nat", adapter: "virtio" };
  }

  async function toggleNetwork(vm) {
    if (networkBusy || !networkEditable(vm)) {
      return;
    }

    const enabling = !networkConfig(vm).enabled;
    networkBusy = "toggle";
    notice = null;
    render(current);

    try {
      const updated = await store.setVmNetworkEnabled(vm.id, enabling);
      notice = {
        severity: "info",
        title: enabling ? "Networking enabled" : "Networking disabled",
        message: enabling
          ? `${updated.name} will attach a NAT Ethernet adapter on its next start.`
          : `${updated.name} will start without a virtual network adapter.`,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Networking could not be changed",
        message: normalized.message,
        code: normalized.code,
      };
    } finally {
      networkBusy = null;
      render(current);
    }
  }

  async function chooseMedia(vm) {
    if (mediaBusy || !mediaEditable(vm)) {
      return;
    }

    mediaBusy = "pick";
    notice = null;
    render(current);

    try {
      const path = await pickIsoFile();

      if (!path) {
        return;
      }

      mediaBusy = "attach";
      render(current);

      const updated = await store.setVmInstallIso(vm.id, path);
      notice = {
        severity: "info",
        title: "Installation ISO attached",
        message: `${fileName(path)} will boot on the next start of ${updated.name}.`,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Installation ISO could not be attached",
        message: normalized.message,
        code: normalized.code,
      };
    } finally {
      mediaBusy = null;
      render(current);
    }
  }

  async function detachMedia(vm) {
    if (mediaBusy || !mediaEditable(vm)) {
      return;
    }

    mediaBusy = "detach";
    notice = null;
    render(current);

    try {
      const updated = await store.setVmInstallIso(vm.id, null);
      notice = {
        severity: "info",
        title: "Installation ISO detached",
        message: `${updated.name} will boot from its virtual disk. The ISO file was not modified.`,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Installation ISO could not be detached",
        message: normalized.message,
        code: normalized.code,
      };
    } finally {
      mediaBusy = null;
      render(current);
    }
  }

  async function switchBootMode(vm, bootMode) {
    if (mediaBusy || !mediaEditable(vm)) {
      return;
    }

    mediaBusy = bootMode;
    notice = null;
    render(current);

    try {
      const updated = await store.setVmBootMode(vm.id, bootMode);
      notice = {
        severity: "info",
        title: "Boot mode updated",
        message:
          updated.bootMode === "installer"
            ? `${updated.name} will boot the installer ISO on its next start.`
            : `${updated.name} will boot from its virtual disk on its next start.`,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Boot mode could not be changed",
        message: normalized.message,
        code: normalized.code,
      };
    } finally {
      mediaBusy = null;
      render(current);
    }
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

    actions.push(
      buttonLink({
        label: "Logs",
        href: `#/machines/${vm.id}/logs`,
        iconName: "log",
        small: true,
      }),
    );

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
          { label: "Guest OS", value: "Not detected", muted: true },
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

    const media = mediaPanel(vm);

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
          text: "Wave VM does not detect guest installation completion. After the installer finishes, stop the machine and switch to disk boot in Installation media.",
        }),
      ],
    });

    return element("div", {
      className: "vm-details-grid",
      children: [overview, networkPanel(vm), storage, media, lifecycle],
    });
  }

  function mediaPanel(vm) {
    const editable = mediaEditable(vm);
    const pending = Boolean(mediaBusy);
    const hasIso = Boolean(vm.installIsoPath);
    const available = Boolean(vm.installIsoAvailable);
    const installer = vm.bootMode === "installer";
    const actions = [];

    if (editable) {
      actions.push(
        button({
          label: pending
            ? "Working…"
            : hasIso
              ? "Replace ISO…"
              : "Choose ISO…",
          iconName: "folder",
          small: true,
          disabled: pending,
          onClick: () => chooseMedia(vm),
        }),
      );

      if (hasIso) {
        actions.push(
          button({
            label: mediaBusy === "detach" ? "Detaching…" : "Detach",
            variant: "ghost",
            small: true,
            disabled: pending,
            onClick: () => detachMedia(vm),
          }),
        );
      }

      if (installer) {
        actions.push(
          button({
            label: mediaBusy === "disk" ? "Switching…" : "Boot from disk",
            variant: "ghost",
            small: true,
            disabled: pending || !vm.diskExists,
            title: "Only switch after the guest installer has finished.",
            onClick: () => switchBootMode(vm, "disk"),
          }),
        );
      } else if (hasIso) {
        actions.push(
          button({
            label:
              mediaBusy === "installer" ? "Switching…" : "Boot installer again",
            variant: "ghost",
            small: true,
            disabled: pending || !available,
            onClick: () => switchBootMode(vm, "installer"),
          }),
        );
      }
    }

    const notes = [];

    if (!hasIso) {
      notes.push(
        element("p", {
          className: "panel-copy",
          text: "No installation media is attached. Choose a local ISO to boot an installer, or start the machine from its existing disk.",
        }),
      );
    } else if (!available) {
      notes.push(
        element("p", {
          className: "vm-card-error",
          text: installer
            ? "The recorded ISO file is missing or unavailable. Attach a replacement ISO, or switch to disk boot to start without it."
            : "The recorded ISO file is missing or unavailable. Disk boot does not need it; attach a replacement to use installer boot again.",
        }),
      );
    }

    if (installer && available) {
      notes.push(
        element("p", {
          className: "panel-copy",
          text: "On the next start QEMU attaches this ISO as a read-only CD/DVD and boots it before the virtual disk.",
        }),
      );
    }

    if (!installer && hasIso) {
      notes.push(
        element("p", {
          className: "panel-copy",
          text: "The ISO stays recorded but is not attached while the machine boots from its virtual disk. Choose Boot installer again to reuse it.",
        }),
      );
    }

    if (!editable) {
      notes.push(
        element("p", {
          className: "panel-note",
          text: "Stop the machine before attaching, replacing, or detaching media, or changing the boot mode.",
        }),
      );
    }

    return createPanel({
      title: "Installation media",
      description:
        "A local ISO used for the guest installer. The ISO is never copied, modified, or deleted.",
      wide: true,
      body: [
        createDetailList([
          {
            label: "Boot mode",
            value: statusIndicator({
              label: bootModeLabel(vm.bootMode),
              tone: installer ? "warn" : "ok",
            }),
          },
          {
            label: "ISO image",
            value: hasIso ? fileName(vm.installIsoPath) : "None attached",
            muted: !hasIso,
          },
          hasIso
            ? { label: "ISO path", value: vm.installIsoPath, code: true }
            : null,
          {
            label: "Media file",
            value: statusIndicator(
              !hasIso
                ? { label: "No media", tone: "neutral" }
                : available
                  ? { label: "Available", tone: "ok" }
                  : { label: "Missing", tone: "error" },
            ),
          },
        ].filter(Boolean)),
        ...notes,
        actions.length
          ? element("div", { className: "media-actions", children: actions })
          : null,
      ],
    });
  }

  function networkPanel(vm) {
    const network = networkConfig(vm);
    const editable = networkEditable(vm);
    const pending = Boolean(networkBusy);
    const enabled = Boolean(network.enabled);

    const notes = [
      element("p", {
        className: "panel-copy",
        text: "Guests see a virtual Ethernet adapter, not the host's Wi-Fi or Ethernet device. QEMU's built-in DHCP service assigns the guest address and forwards DNS queries through the host, so no bridge, TAP device, or guest Wi-Fi configuration is needed.",
      }),
    ];

    if (enabled) {
      notes.push(
        element("p", {
          className: "panel-copy",
          text: "NAT is the default because it works without changing host networking and lets the guest reach the internet through the host's current connection. QEMU user-mode networking supports outbound connections; inbound connections require port forwarding, which this build does not configure.",
        }),
        element("p", {
          className: "panel-note",
          text: "Host connectivity is not verified. If the host temporarily disconnects, the guest keeps its address and may reconnect when the host network returns, but recovery depends on QEMU and the host network stack. Common Linux guests include the VirtIO network driver; guests without it may not detect the adapter.",
        }),
      );
    } else {
      notes.push(
        element("p", {
          className: "vm-card-note",
          text: "No virtual network adapter will be attached. The guest will have no network access until networking is enabled and the machine is started again.",
        }),
      );
    }

    if (!editable) {
      notes.push(
        element("p", {
          className: "panel-note",
          text: "Stop the machine before changing networking. A running QEMU process is never modified.",
        }),
      );
    }

    return createPanel({
      title: "Networking",
      description:
        "NAT through QEMU user-mode networking. Bridged, isolated, and custom modes are planned but not available.",
      wide: true,
      body: [
        createDetailList([
          {
            label: "Networking",
            value: statusIndicator({
              label: enabled ? "Enabled" : "Disabled",
              tone: enabled ? "ok" : "neutral",
            }),
          },
          { label: "Mode", value: networkModeLabel(network.mode) },
          {
            label: "Virtual adapter",
            value: `${networkAdapterLabel(network.adapter)} Ethernet`,
          },
        ]),
        ...notes,
        element("div", {
          className: "media-actions",
          children: [
            button({
              label: pending
                ? "Applying…"
                : enabled
                  ? "Disable networking"
                  : "Enable networking",
              variant: enabled ? "ghost" : "",
              small: true,
              disabled: pending || !editable,
              onClick: () => toggleNetwork(vm),
            }),
          ],
        }),
      ],
    });
  }

  function scopeNote() {
    return element("aside", {
      className: "inline-note",
      children: [
        element("strong", { text: "Current scope" }),
        element("p", {
          text: "Installation media and networking can be changed on a stopped machine. Bridged networking, editing other configuration, deleting machines, and snapshots remain outside this build.",
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
      vm.installIsoPath,
      vm.installIsoAvailable,
      vm.bootMode,
      vm.network?.enabled,
      vm.network?.mode,
      vm.network?.adapter,
      mediaBusy,
      networkBusy,
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
  store.refreshVms({ silent: true });

  return {
    element: page,
    destroy() {
      destroyed = true;
      unsubscribe();
    },
  };
}
