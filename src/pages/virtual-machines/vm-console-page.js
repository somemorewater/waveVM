import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button, buttonLink } from "../../components/button.js";
import { icon } from "../../components/icons.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { getVmConsole } from "../../services/vm-service.js";
import { normalizeError } from "../../services/tauri.js";
import { element } from "../../utils/dom.js";
import { vmStateLabel } from "../../utils/format.js";
import { canStartVm } from "./vm-action-buttons.js";

export function createVmConsolePage({ store, setPageHeader }, id) {
  let current = store.getState();
  let destroyed = false;
  let connectionState = "idle";
  let connectionMessage = "";
  let connectGeneration = 0;
  let rfb = null;
  let headerKey = "";
  let starting = false;
  let stopping = false;
  let notice = null;

  const alerts = createAlertStack();
  const statusArea = element("div", { className: "vm-console-toolbar-meta" });
  const toolbarNote = element("p", { className: "vm-console-toolbar-note" });
  const toolbar = element("div", {
    className: "vm-console-toolbar",
    children: [statusArea, toolbarNote],
  });

  const screen = element("div", {
    className: "vm-console-screen",
    attrs: {
      "aria-label": "Guest display",
      tabindex: "0",
    },
  });

  const overlayIcon = element("div", { className: "vm-console-overlay-icon" });
  const overlayTitle = element("h2", {
    className: "vm-console-overlay-title",
  });
  const overlayMessage = element("p", {
    className: "vm-console-overlay-message",
  });
  const overlayActions = element("div", {
    className: "vm-console-overlay-actions",
  });
  const overlay = element("div", {
    className: "vm-console-overlay",
    attrs: { role: "status", "aria-live": "polite" },
    children: [overlayIcon, overlayTitle, overlayMessage, overlayActions],
  });

  const stage = element("div", {
    className: "vm-console-stage",
    children: [screen, overlay],
  });

  const note = element("p", {
    className: "vm-console-note",
    text: "Click the guest screen to send keyboard and mouse input. The VNC listener is bound to 127.0.0.1 and uses a password generated for this run.",
  });

  const page = element("div", {
    className: "vm-console-page",
    children: [alerts, toolbar, stage, note],
  });

  function findVm(state = current) {
    return state.vms.find((vm) => vm.id === id) || null;
  }

  function backLink() {
    return buttonLink({
      label: "Back to machine",
      href: `#/machines/${id}`,
      iconName: "arrowLeft",
      variant: "ghost",
      small: true,
    });
  }

  function backAction() {
    return buttonLink({
      label: "Back to machine",
      href: `#/machines/${id}`,
      iconName: "arrowLeft",
    });
  }

  function retryAction(label = "Reconnect") {
    return button({
      label,
      iconName: "refresh",
      variant: "primary",
      onClick: () => connect(),
    });
  }

  function startAction() {
    return button({
      label: starting ? "Starting…" : "Start machine",
      iconName: "play",
      variant: "primary",
      disabled: starting,
      onClick: () => startMachine(),
    });
  }

  function overlayPresentation() {
    const vm = findVm();

    switch (connectionState) {
      case "loading":
        return {
          spinner: true,
          title: "Opening console…",
          message: "Requesting a loopback VNC session from QEMU.",
        };
      case "connecting":
        return {
          spinner: true,
          title: "Connecting to guest display…",
          message: "The VNC handshake is in progress.",
        };
      case "connected":
        return null;
      case "disconnected":
        return {
          iconName: "machines",
          title: "Console disconnected",
          message:
            connectionMessage ||
            "The guest display connection ended. Reconnect to continue.",
          actions: [retryAction(), backAction()],
        };
      case "error":
        return {
          iconName: "warning",
          title: "Console could not connect",
          message:
            connectionMessage ||
            "The guest display is unavailable. Check that the machine is still running.",
          actions: [retryAction("Try again"), backAction()],
        };
      case "stopped":
        return {
          iconName: "machines",
          title: "Machine is stopped",
          message:
            (vm && vm.diskExists === false
              ? "The virtual disk is missing, so the machine cannot start."
              : connectionMessage || vm?.lastError) ||
            "Start the machine to open its guest display.",
          actions:
            vm && canStartVm(vm, starting ? "start" : null)
              ? [startAction(), backAction()]
              : [backAction()],
        };
      case "busy": {
        const isStopping = stopping || vm?.state === "stopping";

        return {
          spinner: true,
          title: isStopping ? "Machine is stopping…" : "Machine is starting…",
          message: isStopping
            ? "The console will close when QEMU exits."
            : "The console will open when QEMU is running.",
        };
      }
      case "notfound":
        return {
          iconName: "warning",
          title: "Machine not found",
          message:
            "This machine is not present in the local configuration. It may have been removed outside Wave VM.",
          actions: [backAction()],
        };
      default:
        return {
          spinner: true,
          title: "Preparing console…",
          message: "Loading the machine and its console session.",
        };
    }
  }

  function showOverlay(presentation) {
    overlay.hidden = false;
    overlay.setAttribute(
      "role",
      connectionState === "error" ? "alert" : "status",
    );

    overlayIcon.replaceChildren(
      presentation.spinner
        ? element("span", {
            className: "vm-console-spinner",
            attrs: { "aria-hidden": "true" },
          })
        : icon(presentation.iconName || "machines", 30),
    );
    overlayTitle.textContent = presentation.title;
    overlayMessage.textContent = presentation.message;
    overlayActions.replaceChildren(...(presentation.actions || []));
  }

  function hideOverlay() {
    overlay.hidden = true;
    overlayIcon.replaceChildren();
    overlayActions.replaceChildren();
  }

  function statusFor(vm) {
    switch (connectionState) {
      case "connected":
        return {
          label: "Connected",
          tone: "ok",
          title: "The guest display is connected.",
        };
      case "loading":
      case "connecting":
        return {
          label: "Connecting",
          tone: "warn",
          title: "A console connection is being prepared.",
        };
      case "busy":
        return stopping || vm?.state === "stopping"
          ? {
              label: "Stopping",
              tone: "warn",
              title: "The machine is stopping.",
            }
          : {
              label: "Starting",
              tone: "warn",
              title: "The machine is starting.",
            };
      case "disconnected":
        return {
          label: "Disconnected",
          tone: "warn",
          title: "The console connection ended.",
        };
      case "error":
        return {
          label: "Connection error",
          tone: "error",
          title: connectionMessage || "The console connection failed.",
        };
      case "stopped":
        return {
          label: "Machine stopped",
          tone: "neutral",
          title: vm?.lastError || "The machine is not running.",
        };
      case "notfound":
        return {
          label: "Machine unavailable",
          tone: "error",
          title: "The machine could not be found.",
        };
      default:
        return {
          label: "Preparing",
          tone: "neutral",
          title: "The console is being prepared.",
        };
    }
  }

  function renderToolbar() {
    if (destroyed) {
      return;
    }

    const vm = findVm();
    const summary = statusFor(vm);

    statusArea.replaceChildren(statusIndicator(summary));

    switch (connectionState) {
      case "connected":
        toolbarNote.textContent =
          "Loopback VNC · keyboard and mouse input enabled";
        break;
      case "loading":
      case "connecting":
      case "busy":
        toolbarNote.textContent = "Local QEMU console";
        break;
      case "disconnected":
      case "error":
        toolbarNote.textContent = "The guest display is not connected.";
        break;
      case "stopped":
        toolbarNote.textContent = "Start the machine to open its guest display.";
        break;
      case "notfound":
        toolbarNote.textContent = "The saved machine could not be found.";
        break;
      default:
        toolbarNote.textContent = "Preparing the local console.";
        break;
    }
  }

  function setConnection(state, message = "") {
    if (destroyed) {
      return;
    }

    connectionState = state;
    connectionMessage = message;

    const presentation = overlayPresentation();

    if (presentation) {
      showOverlay(presentation);
    } else {
      hideOverlay();
    }

    renderToolbar();
  }

  function disconnectRfb() {
    const client = rfb;
    rfb = null;

    if (client) {
      try {
        client.disconnect();
      } catch (error) {
        console.warn("Wave VM console disconnect failed", error);
      }
    }

    screen.replaceChildren();
  }

  function cancelConnection() {
    connectGeneration += 1;
    disconnectRfb();
  }

  async function connect() {
    if (destroyed) {
      return;
    }

    if (connectionState === "loading" || connectionState === "connecting") {
      return;
    }

    const vm = findVm();

    if (!vm) {
      setConnection("notfound");
      return;
    }

    if (vm.state !== "running") {
      setConnection("stopped");
      return;
    }

    const generation = ++connectGeneration;
    disconnectRfb();
    setConnection("loading");

    try {
      const session = await getVmConsole(id);

      if (destroyed || generation !== connectGeneration) {
        return;
      }

      const currentVm = findVm();

      if (!currentVm || currentVm.state !== "running") {
        setConnection("stopped");
        return;
      }

      setConnection("connecting");

      const { default: RFB } = await import(
        "../../vendor/novnc/core/rfb.js"
      );

      if (destroyed || generation !== connectGeneration) {
        return;
      }

      const latestVm = findVm();

      if (!latestVm || latestVm.state !== "running") {
        setConnection("stopped");
        return;
      }

      const client = new RFB(screen, session.wsUrl, {
        credentials: { password: session.password },
      });
      rfb = client;

      client.background = "#06182b";
      client.clipViewport = false;
      client.dragViewport = false;
      client.focusOnClick = true;
      client.resizeSession = false;
      client.scaleViewport = true;

      let failureMessage = null;

      client.addEventListener("connect", () => {
        if (rfb === client) {
          setConnection("connected");
        }
      });

      client.addEventListener("securityfailure", (event) => {
        if (rfb !== client) {
          return;
        }

        failureMessage =
          event.detail?.reason ||
          "VNC authentication failed for this console session.";
      });

      client.addEventListener("credentialsrequired", () => {
        if (rfb !== client) {
          return;
        }

        failureMessage =
          "The console requested credentials that were not available.";
        client.disconnect();
      });

      client.addEventListener("disconnect", (event) => {
        if (rfb !== client) {
          return;
        }

        rfb = null;

        if (destroyed || generation !== connectGeneration) {
          return;
        }

        if (failureMessage) {
          setConnection("error", failureMessage);
        } else if (stopping) {
          setConnection("busy");
        } else if (event.detail?.clean) {
          setConnection(
            "disconnected",
            "The console connection was closed. Reconnect to continue.",
          );
        } else {
          setConnection(
            "error",
            "The VNC connection ended unexpectedly. Reconnect to try again.",
          );
        }
      });
    } catch (error) {
      if (destroyed || generation !== connectGeneration) {
        return;
      }

      if (rfb) {
        disconnectRfb();
      }

      const vmNow = findVm();

      if (vmNow && vmNow.state !== "running") {
        setConnection("stopped");
        return;
      }

      const normalized = normalizeError(error);
      setConnection("error", normalized.message);
    }
  }

  async function startMachine() {
    if (starting) {
      return;
    }

    const vm = findVm();

    if (!vm) {
      return;
    }

    starting = true;
    notice = null;
    setConnection("busy");
    renderHeader(vm);
    renderAlerts();

    try {
      await store.startVm(id);
    } catch (error) {
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Machine could not start",
        message: normalized.message,
        code: normalized.code,
      };
      setConnection("stopped");
    } finally {
      starting = false;
      const vmNow = findVm();
      renderHeader(vmNow);
      renderAlerts();
      renderToolbar();
    }
  }

  async function stopMachine() {
    if (stopping) {
      return;
    }

    const vm = findVm();

    if (!vm) {
      return;
    }

    stopping = true;
    notice = null;
    renderHeader(vm);
    renderAlerts();

    try {
      await store.stopVm(id);
    } catch (error) {
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Machine could not stop",
        message: normalized.message,
        code: normalized.code,
      };

      if (!rfb) {
        setConnection(
          "error",
          "The console connection ended while the machine was stopping.",
        );
      }
    } finally {
      stopping = false;
      const vmNow = findVm();
      renderHeader(vmNow);
      renderAlerts();
      renderToolbar();
    }
  }

  function renderAlerts() {
    clearAlerts(alerts);

    if (notice) {
      appendAlert(alerts, notice);
    }
  }

  function renderHeader(vm) {
    if (destroyed) {
      return;
    }

    const actions = [backLink()];

    if (vm?.state === "running") {
      actions.push(
        button({
          label: stopping ? "Stopping…" : "Stop machine",
          iconName: "stop",
          small: true,
          disabled: stopping,
          onClick: () => stopMachine(),
        }),
      );
    } else if (vm && canStartVm(vm, starting ? "start" : null)) {
      actions.push(
        button({
          label: starting ? "Starting…" : "Start machine",
          iconName: "play",
          small: true,
          disabled: starting,
          onClick: () => startMachine(),
        }),
      );
    }

    let title = "Machine console";
    let description = "Loading machine details…";

    if (vm) {
      title = `${vm.name} console`;
      description = `${vmStateLabel(vm.state)} · Guest console`;
    } else if (current.vmsStatus === "error") {
      title = "Console unavailable";
      description = "The saved machine could not be loaded.";
    }

    const key = JSON.stringify([
      title,
      description,
      vm?.state,
      vm?.diskExists,
      starting,
      stopping,
    ]);

    if (key === headerKey) {
      return;
    }

    headerKey = key;
    setPageHeader({
      eyebrow: "Console",
      title,
      description,
      actions,
    });
  }

  function render(state) {
    if (destroyed) {
      return;
    }

    current = state;
    renderAlerts();

    const vm = findVm(state);
    renderHeader(vm);

    if (!vm) {
      if (
        rfb ||
        connectionState === "loading" ||
        connectionState === "connecting"
      ) {
        cancelConnection();
      }

      if (state.vmsStatus === "loading" && state.vms.length === 0) {
        setConnection("idle");
      } else if (state.vmsStatus === "error") {
        setConnection(
          "error",
          state.vmsError?.message || "The machine list could not be loaded.",
        );
      } else {
        setConnection("notfound");
      }

      return;
    }

    if (vm.state === "running") {
      if (
        connectionState === "idle" ||
        connectionState === "stopped" ||
        connectionState === "busy"
      ) {
        connect();
      }

      return;
    }

    if (
      rfb ||
      connectionState === "loading" ||
      connectionState === "connecting"
    ) {
      cancelConnection();
    }

    if (vm.state === "starting" || vm.state === "stopping") {
      setConnection("busy");
    } else {
      setConnection("stopped");
    }
  }

  const unsubscribe = store.subscribe(render);

  return {
    element: page,
    destroy() {
      destroyed = true;
      connectGeneration += 1;
      disconnectRfb();
      unsubscribe();
    },
  };
}
