import { button } from "../../components/button.js";
import { text } from "../../utils/dom.js";

export function canStartVm(vm, busyAction = null) {
  const state = vm?.state || "error";
  return (
    !busyAction &&
    Boolean(vm?.diskExists) &&
    (state === "stopped" || state === "error")
  );
}

export function canStopVm(vm, busyAction = null) {
  return !busyAction && vm?.state === "running";
}

export function createVmActionButtons({
  vm,
  busyAction = null,
  onStart,
  onStop,
  small = true,
}) {
  const name = text(vm.name, "machine");

  return [
    button({
      label: busyAction === "start" ? "Starting…" : "Start",
      iconName: "play",
      small,
      disabled: !canStartVm(vm, busyAction),
      ariaLabel: `Start ${name}`,
      onClick: () => onStart(vm.id),
    }),
    button({
      label: busyAction === "stop" ? "Stopping…" : "Stop",
      iconName: "stop",
      small,
      disabled: !canStopVm(vm, busyAction),
      ariaLabel: `Stop ${name}`,
      onClick: () => onStop(vm.id),
    }),
  ];
}
