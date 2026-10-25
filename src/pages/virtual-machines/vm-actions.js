import { normalizeError } from "../../services/tauri.js";

export function createVmActionController({ store, onChange, onNotice }) {
  const busy = new Map();

  async function run(vm, action) {
    if (!vm || busy.has(vm.id)) {
      return null;
    }

    busy.set(vm.id, action);
    onChange?.();

    try {
      const updated =
        action === "start"
          ? await store.startVm(vm.id)
          : await store.stopVm(vm.id);

      onNotice?.({
        severity: "info",
        title: action === "start" ? "Machine started" : "Machine stopped",
        message:
          action === "start"
            ? `${updated.name} is running as a real QEMU process.`
            : `${updated.name} is stopped.`,
      });

      return updated;
    } catch (error) {
      const normalized = normalizeError(error);
      onNotice?.({
        severity: "error",
        title:
          action === "start"
            ? "Machine could not start"
            : "Machine could not stop",
        message: normalized.message,
        code: normalized.code,
      });
      await store.refreshVms({ silent: true });
      return null;
    } finally {
      busy.delete(vm.id);
      onChange?.();
    }
  }

  return {
    busy,
    run,
    start: (vm) => run(vm, "start"),
    stop: (vm) => run(vm, "stop"),
  };
}
