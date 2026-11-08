import { buttonLink } from "../../components/button.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { element, text } from "../../utils/dom.js";
import {
  accelerationLabel,
  bootModeLabel,
  fileName,
  formatCount,
  networkAdapterLabel,
  networkModeLabel,
  vmStateLabel,
  vmStateTone,
} from "../../utils/format.js";
import { createVmActionButtons } from "./vm-action-buttons.js";

export function createVmCard({ vm, busyAction = null, onStart, onStop }) {
  const state = vm.state || "error";
  const network = vm.network || {
    enabled: true,
    mode: "nat",
    adapter: "virtio",
  };

  const header = element("div", {
    className: "vm-card-header",
    children: [
      element("div", {
        className: "vm-card-title",
        children: [
          element("h3", { text: text(vm.name, "Unnamed machine") }),
          element("p", {
            className: "vm-card-kicker",
            text: `${text(vm.guestArch, "unknown")} guest · ${bootModeLabel(
              vm.bootMode,
            ).toLowerCase()}`,
          }),
        ],
      }),
      statusIndicator({
        label: vmStateLabel(state),
        tone: vmStateTone(state),
      }),
    ],
  });

  const specs = element("dl", {
    className: "vm-specs",
    children: [
      spec("Memory", `${formatCount(vm.memoryMib)} MiB`),
      spec("Virtual CPUs", formatCount(vm.vcpus)),
      spec("Disk", `${formatCount(vm.diskSizeGib)} GiB`),
      spec(
        "Networking",
        network.enabled
          ? `${networkModeLabel(network.mode)} · ${networkAdapterLabel(
              network.adapter,
            )}`
          : "Disabled",
      ),
      spec(
        "Acceleration",
        vm.acceleration ? accelerationLabel(vm.acceleration) : "Not running",
      ),
    ],
  });

  const lastError = vm.lastError
    ? element("p", {
        className: state === "error" ? "vm-card-error" : "vm-card-note",
        text: vm.lastError,
      })
    : null;

  const missingDisk = vm.diskExists
    ? null
    : element("p", {
        className: "vm-card-error",
        text: "The virtual disk is missing. Start is disabled until the disk is restored.",
      });

  const media = vm.installIsoPath
    ? element("p", {
        className:
          vm.bootMode === "installer" && !vm.installIsoAvailable
            ? "vm-card-error"
            : "vm-card-note",
        text:
          vm.bootMode === "installer" && !vm.installIsoAvailable
            ? `Installer ISO ${fileName(vm.installIsoPath)} is missing.`
            : vm.bootMode === "installer"
              ? `Installer ISO: ${fileName(vm.installIsoPath)}`
              : `Disk boot · ISO retained (${fileName(vm.installIsoPath)})`,
      })
    : null;

  const footer = element("div", {
    className: "vm-card-footer",
    children: [
      element("div", {
        className: "vm-card-links",
        children: [
          buttonLink({
            label: "Details",
            href: `#/machines/${encodeURIComponent(vm.id)}`,
            variant: "ghost",
            small: true,
          }),
          buttonLink({
            label: "Logs",
            href: `#/machines/${encodeURIComponent(vm.id)}/logs`,
            iconName: "log",
            variant: "ghost",
            small: true,
          }),
        ],
      }),
      element("div", {
        className: "vm-card-actions",
        children: createVmActionButtons({
          vm,
          busyAction,
          onStart,
          onStop,
        }),
      }),
    ],
  });

  return element("article", {
    className: "vm-card",
    attrs: {
      "data-state": state,
      "aria-label": text(vm.name, "Machine"),
    },
    children: [header, specs, lastError, missingDisk, media, footer],
  });
}

function spec(label, value) {
  return element("div", {
    className: "vm-spec",
    children: [
      element("dt", { text: label }),
      element("dd", { text: value }),
    ],
  });
}
