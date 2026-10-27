import { detectHost } from "../services/host-service.js";
import { getAppInfo } from "../services/app-service.js";
import {
  createVm as createVmRequest,
  listVms,
  setVmBootMode as setVmBootModeRequest,
  setVmInstallIso as setVmInstallIsoRequest,
  startVm as startVmRequest,
  stopVm as stopVmRequest,
} from "../services/vm-service.js";
import { normalizeError } from "../services/tauri.js";

const VM_POLL_INTERVAL = 3000;
const ACTIVE_STATES = new Set(["starting", "running", "stopping"]);

function upsertVm(vms, updated) {
  const index = vms.findIndex((vm) => vm.id === updated.id);

  if (index < 0) {
    return [...vms, updated];
  }

  return vms.map((vm, current) => (current === index ? updated : vm));
}

export function createAppStore() {
  let state = {
    host: null,
    hostStatus: "idle",
    hostError: null,
    appInfo: null,
    appInfoStatus: "idle",
    appInfoError: null,
    vms: [],
    vmsStatus: "idle",
    vmsError: null,
  };

  const listeners = new Set();
  let hostRequest = null;
  let vmsRequest = null;
  let vmsQueued = false;
  let pollTimer = null;
  let destroyed = false;

  function setState(patch) {
    if (destroyed) {
      return;
    }

    state = { ...state, ...patch };

    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error("Wave VM state listener failed", error);
      }
    }
  }

  function updatePolling() {
    if (destroyed) {
      return;
    }

    const active = state.vms.some((vm) => ACTIVE_STATES.has(vm.state));

    if (active && !pollTimer) {
      pollTimer = window.setInterval(() => {
        if (!document.hidden) {
          refreshVms({ silent: true });
        }
      }, VM_POLL_INTERVAL);
    } else if (!active && pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function onVisibilityChange() {
    if (!document.hidden && state.vms.some((vm) => ACTIVE_STATES.has(vm.state))) {
      refreshVms({ silent: true });
    }
  }

  function refreshHost() {
    if (hostRequest) {
      return hostRequest;
    }

    if (destroyed) {
      return Promise.resolve(state.host);
    }

    setState({
      hostStatus: "loading",
      hostError: null,
      appInfoStatus: "loading",
      appInfoError: null,
    });

    hostRequest = (async () => {
      const [hostResult, appInfoResult] = await Promise.allSettled([
        detectHost(),
        getAppInfo(),
      ]);

      const patch = {};

      if (hostResult.status === "fulfilled") {
        patch.host = hostResult.value;
        patch.hostStatus = "ready";
        patch.hostError = null;
      } else {
        patch.hostStatus = state.host ? "stale" : "error";
        patch.hostError = normalizeError(hostResult.reason);
      }

      if (appInfoResult.status === "fulfilled") {
        patch.appInfo = appInfoResult.value;
        patch.appInfoStatus = "ready";
        patch.appInfoError = null;
      } else {
        patch.appInfoStatus = state.appInfo ? "stale" : "error";
        patch.appInfoError = normalizeError(appInfoResult.reason);
      }

      setState(patch);
      return state.host;
    })().finally(() => {
      hostRequest = null;
    });

    return hostRequest;
  }

  function refreshVms({ silent = false } = {}) {
    if (destroyed) {
      return Promise.resolve(state.vms);
    }

    if (vmsRequest) {
      vmsQueued = true;
      return vmsRequest;
    }

    if (!silent || state.vmsStatus === "idle") {
      setState({ vmsStatus: "loading", vmsError: null });
    }

    vmsRequest = (async () => {
      try {
        const result = await listVms();
        setState({
          vms: Array.isArray(result) ? result : [],
          vmsStatus: "ready",
          vmsError: null,
        });
      } catch (error) {
        setState({
          vmsStatus: state.vms.length > 0 ? "stale" : "error",
          vmsError: normalizeError(error),
        });
      }

      updatePolling();
      return state.vms;
    })();

    vmsRequest.finally(() => {
      vmsRequest = null;

      if (vmsQueued && !destroyed) {
        vmsQueued = false;
        refreshVms({ silent: true });
      }
    });

    return vmsRequest;
  }

  function applyVmUpdate(vm) {
    setState({
      vms: upsertVm(state.vms, vm),
      vmsStatus: "ready",
      vmsError: null,
    });
    updatePolling();
    refreshVms({ silent: true });
    return vm;
  }

  async function createVm(input) {
    return applyVmUpdate(await createVmRequest(input));
  }

  async function startVm(id) {
    return applyVmUpdate(await startVmRequest(id));
  }

  async function stopVm(id) {
    return applyVmUpdate(await stopVmRequest(id));
  }

  async function setVmInstallIso(id, path) {
    return applyVmUpdate(await setVmInstallIsoRequest(id, path));
  }

  async function setVmBootMode(id, bootMode) {
    return applyVmUpdate(await setVmBootModeRequest(id, bootMode));
  }

  function subscribe(listener) {
    listeners.add(listener);

    try {
      listener(state);
    } catch (error) {
      console.error("Wave VM state listener failed", error);
    }

    return () => {
      listeners.delete(listener);
    };
  }

  function initialize() {
    document.addEventListener("visibilitychange", onVisibilityChange);
    refreshHost();
    refreshVms();
  }

  function destroy() {
    destroyed = true;

    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }

    document.removeEventListener("visibilitychange", onVisibilityChange);
    listeners.clear();
  }

  return {
    getState: () => state,
    getVm: (id) => state.vms.find((vm) => vm.id === id) || null,
    subscribe,
    initialize,
    refreshHost,
    refreshVms,
    createVm,
    startVm,
    stopVm,
    setVmInstallIso,
    setVmBootMode,
    destroy,
  };
}
