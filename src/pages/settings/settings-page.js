import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button } from "../../components/button.js";
import { createDetailList } from "../../components/detail-list.js";
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
import { element } from "../../utils/dom.js";
import { formatTimestamp } from "../../utils/format.js";
import {
  getThemePreference,
  setThemePreference,
  THEME_OPTIONS,
} from "../../services/settings-service.js";

export function createSettingsPage({ store, setPageHeader }) {
  let current = store.getState();
  let notice = null;
  let destroyed = false;
  let theme = getThemePreference();
  let hostKey = "";
  let appKey = "";
  let locationsKey = "";

  const alerts = createAlertStack();
  const themeControl = element("div", {
    className: "segmented-control",
    attrs: { role: "group", "aria-label": "Theme preference" },
  });
  const hostRegion = element("div", { className: "host-panel" });
  const appRegion = element("div", { className: "settings-app-region" });
  const locationsRegion = element("div", { className: "settings-locations" });

  const refreshButton = button({
    label: "Recheck host",
    iconName: "refresh",
    onClick: () => store.refreshHost(),
  });

  const page = element("div", {
    className: "page-stack",
    children: [
      alerts,
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Preferences",
            title: "Appearance",
            description:
              "Display preferences are stored locally on this device.",
          }),
          createPanel({
            title: "Theme",
            description:
              "System follows the operating system appearance. Light and Dark override it.",
            body: [
              element("div", {
                className: "settings-row",
                children: [
                  element("div", {
                    className: "settings-row-copy",
                    children: [
                      element("h3", { text: "Application theme" }),
                      element("p", {
                        text: "The theme is applied immediately and does not require a restart.",
                      }),
                    ],
                  }),
                  themeControl,
                ],
              }),
            ],
          }),
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Environment",
            title: "Host and virtualization",
            description:
              "These values come from the Rust host probe. They are read-only.",
          }),
          hostRegion,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Networking",
            title: "How guest networking works",
            description:
              "NAT is enabled by default for new machines. Networking settings are stored with each machine.",
          }),
          createPanel({
            title: "QEMU user-mode NAT",
            description: "The only networking mode implemented in this build.",
            body: [
              element("p", {
                className: "panel-copy",
                text: "Guests see a VirtIO Ethernet adapter rather than the host's Wi-Fi or Ethernet device. QEMU runs a small DHCP server and DNS forwarder, so common Linux guests obtain an address and resolver automatically.",
              }),
              element("p", {
                className: "panel-copy",
                text: "NAT lets the guest open outbound connections through the host's current internet connection. It does not require a bridge, TAP device, host networking service change, or guest Wi-Fi setup.",
              }),
              element("p", {
                className: "panel-copy",
                text: "Inbound connections from the host or external network are not supported without port forwarding, which this build does not configure. Bridged, isolated, and custom networking are planned but not selectable.",
              }),
              element("p", {
                className: "panel-note",
                text: "Wave VM does not verify guest internet access. If the host disconnects, the guest keeps its configuration and may recover when the host reconnects, depending on QEMU and the host network stack.",
              }),
            ],
          }),
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Application",
            title: "Application information",
            description:
              "Version and local configuration reported by the backend.",
          }),
          appRegion,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Paths",
            title: "Storage locations",
            description:
              "Wave VM uses the platform application data directory. These paths are not configurable in this build.",
          }),
          locationsRegion,
        ],
      }),
    ],
  });

  setPageHeader({
    eyebrow: "Application",
    title: "Settings",
    description:
      "Appearance, host capabilities, application information, and local storage.",
    actions: [refreshButton],
  });

  function renderThemeControl() {
    themeControl.replaceChildren(
      ...THEME_OPTIONS.map((option) => {
        const active = option.value === theme;
        const node = element("button", {
          className: "segmented-option",
          text: option.label,
          attrs: {
            type: "button",
            "data-active": active ? "true" : "false",
            "aria-pressed": active ? "true" : "false",
          },
        });

        node.addEventListener("click", () => {
          theme = setThemePreference(option.value);
          renderThemeControl();
          notice = {
            severity: "info",
            title: "Appearance updated",
            message: `Theme preference set to ${option.label.toLowerCase()}.`,
          };
          renderAlerts(current);
        });

        return node;
      }),
    );
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

    if (notice) {
      appendAlert(alerts, notice);
    }
  }

  function renderHost(state) {
    if (state.hostStatus === "loading" && !state.host) {
      renderHostLoading(hostRegion, 5);
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
        include: ["system", "kvm", "qemu", "qemuImg", "storage"],
      });
    }
  }

  function renderApplication(state) {
    appRegion.replaceChildren();

    if (state.appInfoStatus === "loading" && !state.appInfo) {
      appRegion.append(skeletonGrid(1));
      return;
    }

    if (state.appInfoError && !state.appInfo) {
      appRegion.append(
        createErrorCard({
          title: "Application information could not be loaded",
          message: state.appInfoError.message,
          code: state.appInfoError.code,
          onRetry: () => store.refreshHost(),
        }),
      );
      return;
    }

    if (!state.appInfo) {
      appRegion.append(
        element("p", {
          className: "panel-note",
          text: "Application information was not returned by the backend.",
        }),
      );
      return;
    }

    appRegion.append(
      createPanel({
        title: "Wave VM",
        description: "Local desktop application.",
        body: [
          createDetailList([
            { label: "Application", value: state.appInfo.name || "Wave VM" },
            { label: "Version", value: `v${state.appInfo.version}` },
            {
              label: "Configuration schema",
              value: `v${state.appInfo.schemaVersion}`,
              code: true,
            },
            {
              label: "Last opened",
              value: formatTimestamp(state.appInfo.lastOpenedUnix),
            },
          ]),
          element("p", {
            className: "panel-note",
            text: "Wave VM runs locally. No account, subscription, cloud service, or remote server is required.",
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
          title: "Storage locations could not be loaded",
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
          text: "Storage locations were not returned by the backend.",
        }),
      );
      return;
    }

    locationsRegion.append(
      createPanel({
        title: "Local data",
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
            text: "Configuration is written atomically in the platform application data directory. These locations are not editable in this build.",
          }),
        ],
      }),
    );
  }

  function updateRefreshButton(state) {
    const loading = state.hostStatus === "loading";
    refreshButton.disabled = loading;
    const label = refreshButton.querySelector("span");
    if (label) {
      label.textContent = loading ? "Checking…" : "Recheck host";
    }
  }

  function render(state) {
    if (destroyed) {
      return;
    }

    current = state;
    renderAlerts(state);
    updateRefreshButton(state);

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

    const nextAppKey = [
      state.appInfoStatus,
      state.appInfo?.version,
      state.appInfo?.schemaVersion,
      state.appInfo?.lastOpenedUnix,
      state.appInfoError?.code,
    ].join("|");

    if (nextAppKey !== appKey) {
      appKey = nextAppKey;
      renderApplication(state);
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

  renderThemeControl();
  const unsubscribe = store.subscribe(render);

  return {
    element: page,
    destroy() {
      destroyed = true;
      unsubscribe();
    },
  };
}
