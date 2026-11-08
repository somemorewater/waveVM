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

export function getVmLogs(id, sessionId = null) {
  return invoke("get_vm_logs", { id, sessionId });
}

export function exportVmLog(id, sessionId = null) {
  return invoke("export_vm_log", { id, sessionId });
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

export function setVmNetworkEnabled(id, enabled) {
  return invoke("set_vm_network_enabled", { id, enabled });
}
