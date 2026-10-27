import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button, buttonLink } from "../../components/button.js";
import { createEmptyState } from "../../components/empty-state.js";
import { icon } from "../../components/icons.js";
import { sectionHeading } from "../../components/section.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { normalizeError } from "../../services/tauri.js";
import { pickIsoFile } from "../../services/vm-service.js";
import { element } from "../../utils/dom.js";
import {
  bootModeLabel,
  fileName,
  vmStateLabel,
  vmStateTone,
} from "../../utils/format.js";

export function createInstallationMediaPage({ store, setPageHeader }) {
  let notice = null;
  let activeAction = null;
  let lastKey = null;

  const alerts = createAlertStack();
  const list = element("div", { className: "media-list" });

  const page = element("div", {
    className: "page-stack",
    children: [
      alerts,
      element("section", {
        className: "media-hero",
        children: [
          element("div", {
            className: "media-hero-copy",
            children: [
              element("p", { className: "eyebrow", text: "Local ISO images" }),
              element("h2", { text: "Install from media you already have." }),
              element("p", {
                className: "media-hero-description",
                text: "Attach an existing .iso file to a machine. Wave VM passes it to QEMU as a read-only CD/DVD for installer boot, then lets you switch back to the virtual disk. The ISO is never copied, downloaded, modified, or deleted.",
              }),
              element("div", {
                className: "media-status",
                children: [
                  statusIndicator({
                    label: "Local files only",
                    tone: "ok",
                  }),
                  buttonLink({
                    label: "Go to virtual machines",
                    href: "#/machines",
                    variant: "ghost",
                  }),
                ],
              }),
            ],
          }),
          element("div", {
            className: "media-hero-art",
            attrs: { "aria-hidden": "true" },
            children: [
              element("span", {
                className: "media-hero-icon",
                children: [icon("media", 56)],
              }),
              element("span", {
                className: "media-hero-art-label",
                text: "ISO / installation media",
              }),
            ],
          }),
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Machines",
            title: "Installation media by machine",
            description:
              "Media can only be changed while a machine is stopped. A running machine keeps the QEMU arguments it started with.",
          }),
          list,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Scope",
            title: "What this build supports",
            description:
              "Local installation media is implemented without an online catalogue or image downloads.",
          }),
          element("div", {
            className: "scope-grid",
            children: [
              element("article", {
                className: "scope-card",
                children: [
                  element("h3", { text: "Works today" }),
                  element("ul", {
                    className: "scope-list scope-list-ready",
                    children: [
                      "Select a local ISO with the native file picker",
                      "Attach, replace, or detach media on a stopped machine",
                      "Boot the ISO as a read-only CD/DVD in installer mode",
                      "Switch to disk boot after installation",
                      "Keep the ISO file untouched and outside the VM data directory",
                    ].map((item) => element("li", { text: item })),
                  }),
                ],
              }),
              element("article", {
                className: "scope-card scope-card-muted",
                children: [
                  element("h3", { text: "Not available yet" }),
                  element("ul", {
                    className: "scope-list",
                    children: [
                      "Image downloads or an online OS catalogue",
                      "Checksum or signature verification",
                      "Automatic detection of installation completion",
                      "Multiple or additional CD/DVD drives",
                    ].map((item) => element("li", { text: item })),
                  }),
                ],
              }),
            ],
          }),
          element("aside", {
            className: "inline-note",
            children: [
              element("strong", { text: "No guest images are bundled" }),
              element("p", {
                text: "Wave VM never includes guest operating system images. You provide an ISO, and installation completion is confirmed by you before switching the boot mode to the virtual disk.",
              }),
            ],
          }),
        ],
      }),
    ],
  });

  setPageHeader({
    eyebrow: "Workspace",
    title: "Installation media",
    description:
      "Attach local ISO images to machines and choose what boots next.",
  });

  function mediaEditable(vm) {
    return !["starting", "running", "stopping"].includes(vm.state);
  }

  function isBusy(vm, action = null) {
    if (!activeAction || activeAction.id !== vm.id) {
      return false;
    }

    return action ? activeAction.action === action : true;
  }

  async function chooseMedia(vm) {
    if (activeAction || !mediaEditable(vm)) {
      return;
    }

    activeAction = { id: vm.id, action: "choose" };
    notice = null;
    render();

    try {
      const path = await pickIsoFile();

      if (!path) {
        return;
      }

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
      activeAction = null;
      render();
    }
  }

  async function detachMedia(vm) {
    await changeMedia(vm, null, "detach", {
      title: "Installation ISO detached",
      message: `${vm.name} will boot from its virtual disk. The ISO file was not modified.`,
      errorTitle: "Installation ISO could not be detached",
    });
  }

  async function switchBootMode(vm, bootMode) {
    if (activeAction || !mediaEditable(vm)) {
      return;
    }

    activeAction = { id: vm.id, action: bootMode };
    notice = null;
    render();

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
      activeAction = null;
      render();
    }
  }

  async function changeMedia(vm, path, action, messages) {
    if (activeAction || !mediaEditable(vm)) {
      return;
    }

    activeAction = { id: vm.id, action };
    notice = null;
    render();

    try {
      await store.setVmInstallIso(vm.id, path);
      notice = {
        severity: "info",
        title: messages.title,
        message: messages.message,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      notice = {
        severity: "error",
        title: messages.errorTitle,
        message: normalized.message,
        code: normalized.code,
      };
    } finally {
      activeAction = null;
      render();
    }
  }

  function mediaRow(vm) {
    const editable = mediaEditable(vm);
    const busy = Boolean(activeAction && activeAction.id === vm.id);
    const hasIso = Boolean(vm.installIsoPath);
    const available = Boolean(vm.installIsoAvailable);
    const installer = vm.bootMode === "installer";
    const actions = [];

    if (editable) {
      actions.push(
        button({
          label: isBusy(vm, "choose")
            ? "Choosing…"
            : hasIso
              ? "Replace ISO…"
              : "Attach ISO…",
          iconName: "folder",
          small: true,
          disabled: busy,
          onClick: () => chooseMedia(vm),
        }),
      );

      if (hasIso) {
        actions.push(
          button({
            label: isBusy(vm, "detach") ? "Detaching…" : "Detach",
            variant: "ghost",
            small: true,
            disabled: busy,
            onClick: () => detachMedia(vm),
          }),
        );

        actions.push(
          button({
            label:
              isBusy(vm, "disk")
                ? "Switching…"
                : isBusy(vm, "installer")
                  ? "Switching…"
                  : installer
                    ? "Boot from disk"
                    : "Boot installer again",
            variant: "ghost",
            small: true,
            disabled: busy || (!installer && !available) || !vm.diskExists,
            title: installer
              ? "Only switch after the guest installer has finished."
              : null,
            onClick: () => switchBootMode(vm, installer ? "disk" : "installer"),
          }),
        );
      }
    }

    return element("article", {
      className: "media-entry",
      children: [
        element("div", {
          className: "media-entry-main",
          children: [
            element("div", {
              className: "media-entry-head",
              children: [
                element("h3", { text: vm.name }),
                statusIndicator({
                  label: vmStateLabel(vm.state),
                  tone: vmStateTone(vm.state),
                }),
              ],
            }),
            element("p", {
              className: hasIso ? "media-entry-file" : "media-entry-file is-muted",
              text: hasIso ? fileName(vm.installIsoPath) : "No ISO attached",
            }),
            hasIso
              ? element("p", {
                  className:
                    installer && !available
                      ? "media-entry-detail is-error"
                      : "media-entry-detail",
                  text: `${bootModeLabel(vm.bootMode)} · ${
                    available ? "media available" : "media missing"
                  }${installer ? "" : " · ISO retained but not attached"}`,
                })
              : element("p", {
                  className: "media-entry-detail",
                  text: "Disk boot · no installation media",
                }),
            !editable
              ? element("p", {
                  className: "panel-note",
                  text: "Stop the machine to change its installation media.",
                })
              : null,
          ],
        }),
        element("div", {
          className: "media-entry-actions",
          children: [
            ...actions,
            buttonLink({
              label: "Open machine",
              href: `#/machines/${encodeURIComponent(vm.id)}`,
              variant: "ghost",
              small: true,
            }),
          ],
        }),
      ],
    });
  }

  function listKey(state) {
    return JSON.stringify([
      state.vmsStatus,
      state.vmsError?.code,
      activeAction,
      notice?.title,
      state.vms.map((vm) => [
        vm.id,
        vm.name,
        vm.state,
        vm.diskExists,
        vm.installIsoPath,
        vm.installIsoAvailable,
        vm.bootMode,
      ]),
    ]);
  }

  function render(state = store.getState()) {
    clearAlerts(alerts);

    if (notice) {
      appendAlert(alerts, notice);
    }

    if (state.vmsStatus === "error" && state.vms.length === 0) {
      appendAlert(alerts, {
        severity: "error",
        title: "Machines could not be loaded",
        message:
          state.vmsError?.message ||
          "The backend did not return the machine list.",
        code: state.vmsError?.code,
      });
    }

    const key = listKey(state);

    if (key === lastKey) {
      return;
    }

    lastKey = key;
    list.replaceChildren();

    if (state.vmsStatus === "loading" && state.vms.length === 0) {
      list.append(
        element("p", {
          className: "panel-copy",
          text: "Loading saved machines…",
        }),
      );
      return;
    }

    if (state.vmsStatus === "error" && state.vms.length === 0) {
      return;
    }

    if (state.vms.length === 0) {
      list.append(
        createEmptyState({
          eyebrow: "No machines",
          title: "No machines to configure",
          description:
            "Create a machine first, then attach a local ISO to install an operating system.",
          art: false,
          actions: [
            buttonLink({
              label: "Create a machine",
              href: "#/machines",
              variant: "primary",
            }),
          ],
        }),
      );
      return;
    }

    for (const vm of state.vms) {
      list.append(mediaRow(vm));
    }
  }

  const unsubscribe = store.subscribe(render);
  store.refreshVms({ silent: true });

  return {
    element: page,
    destroy() {
      unsubscribe();
    },
  };
}
