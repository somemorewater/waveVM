import { element } from "../utils/dom.js";

export function statusIndicator({ label, tone = "neutral", title = null }) {
  return element("span", {
    className: "status-indicator",
    text: label,
    attrs: {
      "data-tone": tone,
      title,
    },
  });
}

export function hostStatusSummary(state) {
  const hostStatus = state?.hostStatus || "idle";

  if (hostStatus === "idle" || hostStatus === "loading") {
    return {
      label: "Checking host",
      tone: "neutral",
      title: "Reading host virtualization capabilities.",
    };
  }

  if (hostStatus === "error" || !state.host) {
    return {
      label: "Host unavailable",
      tone: "error",
      title: state.hostError?.message || "Host diagnostics did not complete.",
    };
  }

  const host = state.host;
  const warnings = Array.isArray(host.warnings) ? host.warnings : [];
  const qemuStatus = host.qemu?.status;
  const kvmStatus = host.kvm?.status;
  const hasWarning = warnings.some((warning) => warning.severity === "warning");
  const hasError =
    warnings.some((warning) => warning.severity === "error") ||
    qemuStatus === "failed" ||
    kvmStatus === "error";

  if (state.hostError) {
    return {
      label: "Host data stale",
      tone: "warn",
      title: state.hostError.message,
    };
  }

  if (hasError) {
    return {
      label: "Host needs attention",
      tone: "error",
      title: "Open Settings for host diagnostics.",
    };
  }

  if (qemuStatus !== "available") {
    return {
      label: "QEMU unavailable",
      tone: "error",
      title: "QEMU must be available before machines can start.",
    };
  }

  if (kvmStatus === "usable") {
    return {
      label: hasWarning ? "KVM ready · check warnings" : "KVM acceleration ready",
      tone: hasWarning ? "warn" : "ok",
      title: "QEMU is available and KVM acceleration is usable.",
    };
  }

  return {
    label: hasWarning ? "Setup incomplete" : "Software emulation",
    tone: "warn",
    title:
      kvmStatus === "unsupported"
        ? "KVM is not applicable on this host. QEMU software emulation will be used."
        : "KVM is not usable. QEMU software emulation will be used.",
  };
}
