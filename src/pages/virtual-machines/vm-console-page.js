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
import {
  getWindowFullscreen,
  setWindowFullscreen,
} from "../../services/window-service.js";
import { element } from "../../utils/dom.js";
import { vmStateLabel } from "../../utils/format.js";
import { releaseCapture as releaseNoVncCapture } from "../../vendor/novnc/core/util/events.js";
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
  let fullscreen = false;
  let fullscreenPending = false;
  let fullscreenInteraction = false;
  let fullscreenSyncTimer = null;
  let mouseCaptured = false;
  let virtualPointer = null;
  const controlNodes = [];

  const alerts = createAlertStack();
  const statusArea = element("div", { className: "vm-console-toolbar-meta" });
  const toolbarNote = element("p", { className: "vm-console-toolbar-note" });
  const toolbarActions = element("div", {
    className: "vm-console-toolbar-actions",
  });
  const toolbar = element("div", {
    className: "vm-console-toolbar",
    children: [
      element("div", {
        className: "vm-console-toolbar-copy",
        children: [statusArea, toolbarNote],
      }),
      toolbarActions,
    ],
  });

  const screen = element("div", {
    className: "vm-console-screen",
    attrs: {
      "aria-label": "Guest display",
      tabindex: "0",
    },
  });
  const pointerLockSupported =
    typeof screen.requestPointerLock === "function" &&
    typeof document.exitPointerLock === "function";

  const toolbarMouseButton = createMouseControl();
  const toolbarFullscreenButton = createFullscreenControl();
  toolbarActions.append(toolbarMouseButton, toolbarFullscreenButton);

  const immersiveName = element("strong", {
    className: "vm-console-immersive-name",
  });
  const immersiveStatus = element("span", {
    className: "vm-console-immersive-status",
  });
  const immersiveMouseButton = createMouseControl();
  const immersiveFullscreenButton = createFullscreenControl();
  const immersiveBar = element("div", {
    className: "vm-console-immersive-bar",
    attrs: { hidden: true, "aria-label": "Console controls" },
    children: [
      element("div", {
        className: "vm-console-immersive-copy",
        children: [
          immersiveName,
          element("span", {
            className: "vm-console-immersive-divider",
            text: "·",
          }),
          immersiveStatus,
          element("span", {
            className: "vm-console-immersive-hint",
            text: "F11 fullscreen · Esc releases mouse",
          }),
        ],
      }),
      element("div", {
        className: "vm-console-immersive-actions",
        children: [immersiveMouseButton, immersiveFullscreenButton],
      }),
    ],
  });
  const captureHint = element("div", {
    className: "vm-console-capture-hint",
    attrs: { hidden: true, role: "status", "aria-live": "polite" },
    text: "Mouse captured — press Esc to release",
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
    children: [screen, overlay, captureHint, immersiveBar],
  });

  const note = element("p", {
    className: "vm-console-note",
    text: "Click the guest screen to send keyboard and mouse input. F11 or the console controls toggle fullscreen; while the mouse is captured, press Esc to return control to the host. After release, click the guest to resume input, and Escape reaches the guest again. The VNC listener is bound to 127.0.0.1 and uses a password generated for this run.",
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

  function createMouseControl() {
    const node = button({
      label: "Capture mouse",
      iconName: "mouse",
      small: true,
      onClick: () => toggleMouseControl(),
      title: "Capture the host pointer inside the guest display.",
    });

    controlNodes.push({ kind: "mouse", node });
    return node;
  }

  function createFullscreenControl() {
    const node = button({
      label: "Fullscreen",
      iconName: "maximize",
      small: true,
      onClick: () => toggleFullscreen(),
      title: "Enter fullscreen (F11).",
    });

    controlNodes.push({ kind: "fullscreen", node });
    return node;
  }

  function updateControlButton(node, label, iconName, title) {
    const iconNode = node.querySelector("svg");
    const labelNode = node.querySelector("span");

    if (iconNode) {
      iconNode.replaceWith(
        icon(iconName, node.classList.contains("button-small") ? 14 : 16),
      );
    }

    if (labelNode) {
      labelNode.textContent = label;
    }

    node.setAttribute("aria-label", label);
    node.title = title;
  }

  function syncControls() {
    if (destroyed) {
      return;
    }

    for (const { kind, node } of controlNodes) {
      if (kind === "fullscreen") {
        node.disabled = fullscreenPending;
        updateControlButton(
          node,
          fullscreen ? "Exit fullscreen" : "Fullscreen",
          fullscreen ? "minimize" : "maximize",
          fullscreen ? "Leave fullscreen (F11)." : "Enter fullscreen (F11).",
        );
        continue;
      }

      const ready = connectionState === "connected" && Boolean(rfb);
      let label = "Capture mouse";
      let title =
        "Lock the host pointer inside the guest display. Press Esc to release it.";
      let iconName = "mouse";
      let disabled = !ready;

      if (mouseCaptured) {
        label = "Release mouse";
        title = "Press Esc to release the pointer capture.";
        disabled = false;
      } else if (!pointerLockSupported) {
        label = "Focus guest";
        title =
          "Pointer lock is unavailable in this webview. Click the guest display to focus input.";
      }

      node.disabled = disabled;
      updateControlButton(node, label, iconName, title);
    }

    captureHint.hidden = !mouseCaptured;
    immersiveBar.hidden = !fullscreen;
  }

  function renderImmersiveBar() {
    const vm = findVm();
    immersiveName.textContent = vm?.name || "Machine console";
    immersiveStatus.textContent = statusFor(vm).label;
  }

  function setFullscreenState(next) {
    fullscreen = Boolean(next);
    document.body.classList.toggle("console-immersive", fullscreen);
    immersiveBar.hidden = !fullscreen;
    renderImmersiveBar();
    syncControls();
  }

  function focusHostControl() {
    const target = fullscreen
      ? !immersiveMouseButton.disabled
        ? immersiveMouseButton
        : immersiveFullscreenButton
      : !toolbarMouseButton.disabled
        ? toolbarMouseButton
        : toolbarFullscreenButton;

    target?.focus({ preventScroll: true });
  }

  function scheduleFullscreenSync(delay = 220) {
    if (fullscreenSyncTimer !== null) {
      window.clearTimeout(fullscreenSyncTimer);
    }

    fullscreenSyncTimer = window.setTimeout(async () => {
      fullscreenSyncTimer = null;

      if (destroyed || fullscreenPending) {
        return;
      }

      try {
        const actual = await getWindowFullscreen();

        if (destroyed) {
          return;
        }

        if (actual !== fullscreen) {
          setFullscreenState(actual);

          if (!actual) {
            releasePointerCapture({ focusHost: true });
          }
        }
      } catch (error) {
        console.warn("Wave VM could not read fullscreen state", error);
      }

      if (mouseCaptured) {
        clampVirtualPointer();
      }
    }, delay);
  }

  async function applyFullscreen(next) {
    if (destroyed || fullscreenPending) {
      return;
    }

    const value = Boolean(next);
    const previous = fullscreen;
    fullscreenInteraction = true;
    fullscreenPending = true;
    setFullscreenState(value);

    try {
      await setWindowFullscreen(value);

      if (destroyed) {
        return;
      }

      scheduleFullscreenSync();

      if (value) {
        window.requestAnimationFrame(() => {
          if (!destroyed && fullscreen) {
            rfb?.focus({ preventScroll: true });
          }
        });
      } else if (mouseCaptured) {
        releasePointerCapture({ focusHost: true });
      } else {
        focusHostControl();
      }
    } catch (error) {
      if (destroyed) {
        return;
      }

      setFullscreenState(previous);
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: "Fullscreen could not be changed",
        message: normalized.message,
        code: normalized.code,
      };
      renderAlerts();
    } finally {
      fullscreenPending = false;

      if (!destroyed) {
        syncControls();
        renderImmersiveBar();
      }
    }
  }

  function toggleFullscreen() {
    if (destroyed || fullscreenPending) {
      return;
    }

    applyFullscreen(!fullscreen);
  }

  function handleWindowResize() {
    if (destroyed) {
      return;
    }

    if (mouseCaptured) {
      clampVirtualPointer();
    }

    scheduleFullscreenSync(180);
  }

  function canvasMetrics() {
    const canvas = screen.querySelector("canvas");

    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();

    if (rect.width < 2 || rect.height < 2) {
      return null;
    }

    return { canvas, rect };
  }

  function setVirtualPointerToCenter() {
    const metrics = canvasMetrics();

    if (!metrics) {
      virtualPointer = null;
      return null;
    }

    virtualPointer = {
      x: metrics.rect.left + metrics.rect.width / 2,
      y: metrics.rect.top + metrics.rect.height / 2,
    };
    return metrics;
  }

  function clampVirtualPointer() {
    const metrics = canvasMetrics();

    if (!metrics || !virtualPointer) {
      return metrics;
    }

    const minX = metrics.rect.left + 0.5;
    const maxX = Math.max(minX, metrics.rect.right - 0.5);
    const minY = metrics.rect.top + 0.5;
    const maxY = Math.max(minY, metrics.rect.bottom - 0.5);

    virtualPointer = {
      x: Math.min(Math.max(virtualPointer.x, minX), maxX),
      y: Math.min(Math.max(virtualPointer.y, minY), maxY),
    };
    return metrics;
  }

  function dispatchSyntheticMouse(type, buttons, button = 0) {
    const metrics = clampVirtualPointer();

    if (!metrics || !virtualPointer) {
      return;
    }

    metrics.canvas.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: virtualPointer.x,
        clientY: virtualPointer.y,
        screenX: virtualPointer.x,
        screenY: virtualPointer.y,
        button,
        buttons: buttons || 0,
      }),
    );
  }

  function dispatchSyntheticWheel(source) {
    const metrics = clampVirtualPointer();

    if (!metrics || !virtualPointer) {
      return;
    }

    metrics.canvas.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: virtualPointer.x,
        clientY: virtualPointer.y,
        screenX: virtualPointer.x,
        screenY: virtualPointer.y,
        buttons: source.buttons || 0,
        deltaX: source.deltaX,
        deltaY: source.deltaY,
        deltaZ: source.deltaZ,
        deltaMode: source.deltaMode,
      }),
    );
  }

  function moveVirtualPointer(movementX = 0, movementY = 0, buttons = 0) {
    if (!virtualPointer) {
      setVirtualPointerToCenter();
    }

    if (!virtualPointer) {
      return;
    }

    const metrics = canvasMetrics();

    if (!metrics) {
      return;
    }

    const minX = metrics.rect.left + 0.5;
    const maxX = Math.max(minX, metrics.rect.right - 0.5);
    const minY = metrics.rect.top + 0.5;
    const maxY = Math.max(minY, metrics.rect.bottom - 0.5);
    const dx = Number.isFinite(movementX) ? movementX : 0;
    const dy = Number.isFinite(movementY) ? movementY : 0;

    virtualPointer = {
      x: Math.min(Math.max(virtualPointer.x + dx, minX), maxX),
      y: Math.min(Math.max(virtualPointer.y + dy, minY), maxY),
    };

    dispatchSyntheticMouse("mousemove", buttons);
  }

  function handleLockedPointerEvent(event) {
    if (!mouseCaptured || !event.isTrusted) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type === "contextmenu") {
      return;
    }

    if (event.type === "wheel") {
      if (!virtualPointer) {
        setVirtualPointerToCenter();
      }
      clampVirtualPointer();
      dispatchSyntheticWheel(event);
      return;
    }

    if (event.type === "mousemove") {
      moveVirtualPointer(event.movementX, event.movementY, event.buttons);
      return;
    }

    if (!virtualPointer) {
      setVirtualPointerToCenter();
    }

    dispatchSyntheticMouse(event.type, event.buttons, event.button);

    if (event.type === "mousedown") {
      // noVNC installs its own full-window drag capture on mousedown.
      // Pointer lock already provides capture, so remove that overlay.
      releaseNoVncCapture();
    }
  }

  function finalizeMouseRelease({ focusHost = true } = {}) {
    if (!mouseCaptured) {
      return;
    }

    if (virtualPointer) {
      dispatchSyntheticMouse("mouseup", 0, 0);
    }

    releaseNoVncCapture();
    mouseCaptured = false;
    virtualPointer = null;
    syncControls();

    if (focusHost && !destroyed) {
      rfb?.blur();

      if (document.hasFocus()) {
        focusHostControl();
      }
    }
  }

  function releasePointerCapture({ focusHost = true } = {}) {
    if (document.pointerLockElement === screen) {
      try {
        document.exitPointerLock();
      } catch (error) {
        console.warn("Wave VM pointer lock release failed", error);
      }
    }

    finalizeMouseRelease({ focusHost });
  }

  function handlePointerLockChange() {
    if (destroyed) {
      return;
    }

    if (document.pointerLockElement === screen) {
      if (mouseCaptured) {
        return;
      }

      releaseNoVncCapture();
      mouseCaptured = true;
      setVirtualPointerToCenter();
      dispatchSyntheticMouse("mousemove", 0);
      rfb?.focus({ preventScroll: true });
      syncControls();
      return;
    }

    if (mouseCaptured) {
      finalizeMouseRelease({ focusHost: true });
    }
  }

  function handlePointerLockError() {
    if (destroyed) {
      return;
    }

    mouseCaptured = false;
    virtualPointer = null;
    releaseNoVncCapture();
    syncControls();
    notice = {
      severity: "warning",
      title: "Mouse capture could not start",
      message:
        "The webview did not grant pointer lock. Click the guest display to focus it, or use F11 and the fullscreen controls.",
      code: "pointer_lock_unavailable",
    };
    renderAlerts();
  }

  function toggleMouseControl() {
    if (mouseCaptured) {
      releasePointerCapture();
      return;
    }

    if (!rfb || connectionState !== "connected") {
      return;
    }

    if (!pointerLockSupported) {
      rfb.focus({ preventScroll: true });
      notice = {
        severity: "warning",
        title: "Mouse capture is unavailable",
        message:
          "This webview does not support pointer lock. Click the guest display to focus input, and use F11 or the fullscreen controls to leave fullscreen.",
        code: "pointer_lock_unavailable",
      };
      renderAlerts();
      return;
    }

    try {
      const request = screen.requestPointerLock();

      if (request && typeof request.catch === "function") {
        request.catch(handlePointerLockError);
      }
    } catch (error) {
      console.warn("Wave VM pointer lock request failed", error);
      handlePointerLockError();
    }
  }

  function handleHostKeyDown(event) {
    if (destroyed) {
      return;
    }

    if (event.key === "F11" || event.code === "F11") {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (!event.repeat) {
        toggleFullscreen();
      }
      return;
    }

    if (
      event.key === "Escape" &&
      (mouseCaptured || document.pointerLockElement === screen)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      releasePointerCapture();
    }
  }

  function handleHostKeyUp(event) {
    if (
      !destroyed &&
      (event.key === "F11" || event.code === "F11")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
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
          "Loopback VNC · F11 fullscreen · Esc releases mouse capture";
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

    renderImmersiveBar();
    syncControls();
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

    if (mouseCaptured || document.pointerLockElement === screen) {
      releasePointerCapture({ focusHost: false });
    }

    releaseNoVncCapture();

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

        if (mouseCaptured || document.pointerLockElement === screen) {
          releasePointerCapture({ focusHost: false });
        }

        releaseNoVncCapture();

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
    renderImmersiveBar();

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

  const wheelListenerOptions = { capture: true, passive: false };

  document.addEventListener("pointerlockchange", handlePointerLockChange);
  document.addEventListener("pointerlockerror", handlePointerLockError);
  window.addEventListener("keydown", handleHostKeyDown, true);
  window.addEventListener("keyup", handleHostKeyUp, true);
  window.addEventListener("resize", handleWindowResize);
  screen.addEventListener("mousemove", handleLockedPointerEvent, true);
  screen.addEventListener("mousedown", handleLockedPointerEvent, true);
  screen.addEventListener("mouseup", handleLockedPointerEvent, true);
  screen.addEventListener("wheel", handleLockedPointerEvent, wheelListenerOptions);
  screen.addEventListener("contextmenu", handleLockedPointerEvent, true);

  getWindowFullscreen()
    .then((value) => {
      if (!destroyed && !fullscreenInteraction) {
        setFullscreenState(value);
      }
    })
    .catch(() => {
      // The console is also renderable outside the desktop shell for checks.
    });

  const unsubscribe = store.subscribe(render);

  return {
    element: page,
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      connectGeneration += 1;

      if (fullscreenSyncTimer !== null) {
        window.clearTimeout(fullscreenSyncTimer);
        fullscreenSyncTimer = null;
      }

      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      document.removeEventListener("pointerlockerror", handlePointerLockError);
      window.removeEventListener("keydown", handleHostKeyDown, true);
      window.removeEventListener("keyup", handleHostKeyUp, true);
      window.removeEventListener("resize", handleWindowResize);
      screen.removeEventListener("mousemove", handleLockedPointerEvent, true);
      screen.removeEventListener("mousedown", handleLockedPointerEvent, true);
      screen.removeEventListener("mouseup", handleLockedPointerEvent, true);
      screen.removeEventListener("wheel", handleLockedPointerEvent, {
        capture: true,
      });
      screen.removeEventListener("contextmenu", handleLockedPointerEvent, true);

      if (mouseCaptured || document.pointerLockElement === screen) {
        try {
          document.exitPointerLock();
        } catch (error) {
          console.warn("Wave VM pointer lock cleanup failed", error);
        }
      }

      mouseCaptured = false;
      virtualPointer = null;
      releaseNoVncCapture();
      document.body.classList.remove("console-immersive");

      if (fullscreen) {
        setWindowFullscreen(false).catch((error) => {
          console.warn("Wave VM fullscreen cleanup failed", error);
        });
      }

      fullscreen = false;
      disconnectRfb();
      unsubscribe();
    },
  };
}
