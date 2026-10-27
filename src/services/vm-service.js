import { invoke } from "./tauri.js";

export function listVms() {
  return invoke("list_vms");
}

export function createVm(input) {
  return invoke("create_vm", { input });
}

export function startVm(id) {
  return invoke("start_vm", { id });
}

export function stopVm(id) {
  return invoke("stop_vm", { id });
}

export function getVmConsole(id) {
  return invoke("get_vm_console", { id });
}

export function pickIsoFile() {
  return invoke("pick_iso_file");
}

export function setVmInstallIso(id, path) {
  return invoke("set_vm_install_iso", { id, path });
}

export function setVmBootMode(id, bootMode) {
  return invoke("set_vm_boot_mode", { id, bootMode });
}
