import { element } from "../../utils/dom.js";
import {
  fileName,
  formatBytes,
  formatCount,
  formatDisk,
} from "../../utils/format.js";
import {
  appendAlert,
  clearAlerts,
  createAlertStack,
} from "../../components/alerts.js";
import { button } from "../../components/button.js";
import {
  formField,
  formNote,
  numberInput,
  selectInput,
  textInput,
} from "../../components/form-controls.js";
import { openModal } from "../../components/modal.js";
import { normalizeError } from "../../services/tauri.js";
import { pickIsoFile } from "../../services/vm-service.js";

const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

export function openCreateVmDialog({ store, onCreated = null, onClose = null }) {
  let touched = false;
  let busy = false;
  let pickingIso = false;
  let selectedIsoPath = null;
  let unsupportedHost = false;
  let unsubscribe = () => {};

  const hostAlert = createAlertStack("alert-stack form-alert");
  const formAlert = createAlertStack("alert-stack form-alert");

  const name = textInput({
    id: "vm-name",
    name: "name",
    placeholder: "e.g. Linux lab",
    maxLength: 64,
  });
  const arch = selectInput({
    id: "vm-arch",
    name: "guestArch",
    options: [{ value: "x86_64", label: "x86_64" }],
    value: "x86_64",
  });
  const memory = numberInput({
    id: "vm-memory",
    name: "memoryMib",
    value: "1024",
    min: 256,
    max: 65536,
    step: 256,
  });
  const vcpus = numberInput({
    id: "vm-vcpus",
    name: "vcpus",
    value: "2",
    min: 1,
    max: 64,
    step: 1,
  });
  const disk = numberInput({
    id: "vm-disk",
    name: "diskSizeGib",
    value: "20",
    min: 1,
    max: 1024,
    step: 1,
  });

  const memoryHint = element("span", {
    className: "field-hint",
    text: "The backend checks this against host memory.",
  });
  const vcpuHint = element("span", {
    className: "field-hint",
    text: "The backend checks this against logical CPUs.",
  });
  const diskHint = element("span", {
    className: "field-hint",
    text: "A thin-provisioned QCOW2 disk is created.",
  });

  const isoName = element("span", {
    className: "iso-picker-name",
    text: "No ISO selected",
  });
  const isoDetail = element("span", {
    className: "iso-picker-detail",
    text: "Optional. Choose an existing .iso file to boot the installer.",
  });
  const chooseIso = button({
    label: "Choose ISO…",
    iconName: "folder",
    small: true,
    onClick: () => selectIso(),
  });
  const clearIso = button({
    label: "Remove",
    variant: "ghost",
    small: true,
    disabled: true,
    onClick: () => {
      selectedIsoPath = null;
      renderIso();
    },
  });
  const isoPicker = element("div", {
    className: "iso-picker",
    attrs: { id: "vm-iso" },
    children: [
      element("div", {
        className: "iso-picker-summary",
        children: [isoName, isoDetail],
      }),
      element("div", {
        className: "iso-picker-actions",
        children: [chooseIso, clearIso],
      }),
    ],
  });

  const form = element("form", {
    className: "vm-create-form",
    attrs: { id: "vm-create-form", novalidate: true },
    children: [
      hostAlert,
      formAlert,
      element("div", {
        className: "form-grid",
        children: [
          formField({
            label: "Name",
            control: name,
            hint: "Up to 64 characters. The name is stored locally.",
            wide: true,
          }),
          formField({
            label: "Guest architecture",
            control: arch,
            hint: "Only x86_64 guests are supported in this build.",
          }),
          formField({
            label: "Memory (MiB)",
            control: memory,
            hint: memoryHint,
          }),
          formField({
            label: "Virtual CPUs",
            control: vcpus,
            hint: vcpuHint,
          }),
          formField({
            label: "Disk size (GiB)",
            control: disk,
            hint: diskHint,
          }),
          formField({
            label: "Installation ISO (optional)",
            control: isoPicker,
            hint: "The ISO is used read-only and is never copied or modified by Wave VM.",
            wide: true,
          }),
        ],
      }),
      formNote(
        "Wave VM creates a blank QCOW2 disk in the application data directory. If you attach an ISO, the first start boots the installer. Switch to disk boot after installing the guest operating system.",
      ),
    ],
  });

  form.addEventListener("input", () => {
    touched = true;
  });

  const submit = button({
    label: "Create machine",
    variant: "primary",
    type: "submit",
    attrs: { form: "vm-create-form" },
  });
  const cancel = button({
    label: "Cancel",
    onClick: () => modal.close("cancel"),
  });

  const modal = openModal({
    title: "New machine",
    description:
      "Create a local machine with a QCOW2 disk and optional installation ISO. Nothing is downloaded.",
    content: form,
    actions: [cancel, submit],
    initialFocus: name,
    onClose(reason) {
      unsubscribe();
      onClose?.(reason);
    },
  });

  function setBusy(value) {
    busy = value;
    submit.disabled = value || unsupportedHost;
    cancel.disabled = value;
    chooseIso.disabled = value || pickingIso;
    clearIso.disabled = value || pickingIso || !selectedIsoPath;
    modal.setDismissible(!value);

    const label = submit.querySelector("span");
    if (label) {
      label.textContent = value ? "Creating…" : "Create machine";
    }

    for (const control of form.querySelectorAll("input, select")) {
      control.disabled = value;
    }
  }

  function renderIso() {
    isoName.textContent = selectedIsoPath
      ? fileName(selectedIsoPath)
      : "No ISO selected";
    isoDetail.textContent = selectedIsoPath
      ? selectedIsoPath
      : "Optional. Choose an existing .iso file to boot the installer.";

    const label = chooseIso.querySelector("span");
    if (label) {
      label.textContent = selectedIsoPath ? "Replace ISO…" : "Choose ISO…";
    }

    chooseIso.disabled = busy || pickingIso;
    clearIso.disabled = busy || pickingIso || !selectedIsoPath;
  }

  async function selectIso() {
    if (busy || pickingIso) {
      return;
    }

    clearAlerts(formAlert);
    pickingIso = true;
    renderIso();

    try {
      const path = await pickIsoFile();

      if (!path) {
        return;
      }

      selectedIsoPath = path;
    } catch (error) {
      const normalized = normalizeError(error);
      appendAlert(formAlert, {
        severity: "error",
        title: "ISO could not be selected",
        message: normalized.message,
        code: normalized.code,
      });
    } finally {
      pickingIso = false;
      renderIso();
    }
  }

  function updateHostState(state) {
    const host = state.host;
    unsupportedHost = Boolean(
      host && (host.os !== "linux" || host.arch !== "x86_64"),
    );

    clearAlerts(hostAlert);

    if (unsupportedHost) {
      appendAlert(hostAlert, {
        severity: "warning",
        title: "Unsupported host",
        message: `This build requires a Linux x86_64 host. The host reports ${host.os} ${host.arch}.`,
      });
    }

    if (!busy && !touched) {
      applyDefaults(host);
    }

    updateLimits(host);
    submit.disabled = busy || unsupportedHost;
  }

  function applyDefaults(host) {
    if (!host) {
      return;
    }

    const totalMib = bytesToMib(host.memory?.totalBytes);
    const availableMib = bytesToMib(host.memory?.availableBytes);

    let memoryValue = 1024;

    if (availableMib > 0) {
      memoryValue = Math.min(
        2048,
        Math.max(512, Math.floor(availableMib / 2)),
      );
    } else if (totalMib > 0) {
      memoryValue = Math.min(2048, Math.max(512, Math.floor(totalMib / 4)));
    }

    memory.value = String(roundToStep(memoryValue, 256));
    vcpus.value = String(Math.max(1, Math.min(2, host.cpuLogical || 1)));

    const freeGib = bytesToGib(host.storage?.freeBytes);

    if (freeGib > 0) {
      disk.value = String(Math.max(1, Math.min(20, freeGib - 1)));
    } else if (Number.isFinite(host.storage?.freeBytes)) {
      disk.value = "1";
    } else {
      disk.value = "20";
    }
  }

  function updateLimits(host) {
    if (!host) {
      memory.max = "65536";
      vcpus.max = "64";
      disk.max = "1024";
      memoryHint.textContent =
        "The backend checks this against host memory.";
      vcpuHint.textContent =
        "The backend checks this against logical CPUs.";
      diskHint.textContent = "A thin-provisioned QCOW2 disk is created.";
      return;
    }

    const totalMib = bytesToMib(host.memory?.totalBytes);

    if (totalMib > 0) {
      memory.max = String(Math.max(256, Math.min(65536, totalMib)));
      memoryHint.textContent = `Host total: ${formatBytes(
        host.memory.totalBytes,
      )}. The default leaves room for the host.`;
    }

    if (host.cpuLogical) {
      vcpus.max = String(Math.max(1, Math.min(64, host.cpuLogical)));
      vcpuHint.textContent = `${formatCount(
        host.cpuLogical,
      )} logical CPUs detected.`;
    }

    const freeBytes = host.storage?.freeBytes;

    if (Number.isFinite(freeBytes)) {
      const freeGib = Math.floor(freeBytes / GIB);
      disk.max = String(Math.max(1, Math.min(1024, freeGib)));
      diskHint.textContent = `${formatBytes(
        freeBytes,
      )} free on the application data filesystem.`;
    }
  }

  function readInput() {
    return {
      name: name.value.trim(),
      guestArch: arch.value,
      memoryMib: Number(memory.value),
      vcpus: Number(vcpus.value),
      diskSizeGib: Number(disk.value),
      installIsoPath: selectedIsoPath,
    };
  }

  function validateCreateInput(input, host) {
    if (!input.name) {
      return {
        title: "Name required",
        message: "Enter a name for the machine.",
      };
    }

    if (Array.from(input.name).length > 64) {
      return {
        title: "Name too long",
        message: "The machine name cannot be longer than 64 characters.",
      };
    }

    if (/[\u0000-\u001f\u007f]/.test(input.name)) {
      return {
        title: "Invalid name",
        message: "The machine name cannot contain control characters.",
      };
    }

    if (/[/\\,=]/.test(input.name)) {
      return {
        title: "Invalid name",
        message:
          "The machine name cannot contain /, \\, comma, or equals characters.",
      };
    }

    if (
      !Number.isInteger(input.memoryMib) ||
      input.memoryMib < 256 ||
      input.memoryMib > 65536
    ) {
      return {
        title: "Invalid memory",
        message: "Memory must be a whole number between 256 and 65,536 MiB.",
      };
    }

    const totalMib = bytesToMib(host?.memory?.totalBytes);

    if (totalMib > 0 && input.memoryMib > totalMib) {
      return {
        title: "Memory exceeds host capacity",
        message: `Memory cannot exceed the host's total memory of ${formatCount(
          totalMib,
        )} MiB.`,
      };
    }

    if (
      !Number.isInteger(input.vcpus) ||
      input.vcpus < 1 ||
      input.vcpus > 64
    ) {
      return {
        title: "Invalid CPU count",
        message: "Virtual CPUs must be a whole number between 1 and 64.",
      };
    }

    if (host?.cpuLogical && input.vcpus > host.cpuLogical) {
      return {
        title: "CPU count exceeds host capacity",
        message: `Virtual CPUs cannot exceed the host's ${formatCount(
          host.cpuLogical,
        )} logical CPUs.`,
      };
    }

    if (
      !Number.isInteger(input.diskSizeGib) ||
      input.diskSizeGib < 1 ||
      input.diskSizeGib > 1024
    ) {
      return {
        title: "Invalid disk size",
        message: "Disk size must be a whole number between 1 and 1,024 GiB.",
      };
    }

    const freeBytes = host?.storage?.freeBytes;

    if (Number.isFinite(freeBytes)) {
      const freeGib = Math.floor(freeBytes / GIB);

      if (input.diskSizeGib > freeGib) {
        return {
          title: "Disk exceeds free space",
          message: `The requested ${formatDisk(
            input.diskSizeGib,
          )} disk exceeds the ${formatCount(
            freeGib,
          )} GiB free on the application data filesystem.`,
        };
      }
    }

    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearAlerts(formAlert);

    const input = readInput();
    const problem = validateCreateInput(input, store.getState().host);

    if (problem) {
      appendAlert(formAlert, {
        severity: "error",
        title: problem.title,
        message: problem.message,
      });
      return;
    }

    setBusy(true);

    try {
      const vm = await store.createVm(input);

      if (!modal.isOpen()) {
        return;
      }

      setBusy(false);
      modal.close("created");
      onCreated?.(vm);
    } catch (error) {
      if (!modal.isOpen()) {
        return;
      }

      const normalized = normalizeError(error);
      setBusy(false);
      appendAlert(formAlert, {
        severity: "error",
        title: "Machine could not be created",
        message: normalized.message,
        code: normalized.code,
      });
    }
  }

  form.addEventListener("submit", handleSubmit);
  unsubscribe = store.subscribe(updateHostState);

  return modal;
}

function bytesToMib(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value / MIB) : 0;
}

function bytesToGib(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value / GIB) : 0;
}

function roundToStep(value, step) {
  return Math.max(step, Math.floor(value / step) * step);
}
