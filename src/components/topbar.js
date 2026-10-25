import { element } from "../utils/dom.js";
import { formatCount } from "../utils/format.js";
import { hostStatusSummary, statusIndicator } from "./status-indicator.js";

export function createTopbar({ store }) {
  const eyebrow = element("p", { className: "topbar-eyebrow", text: "Workspace" });
  const title = element("h1", {
    className: "topbar-title",
    attrs: { id: "page-title" },
  });
  const description = element("p", { className: "topbar-description" });
  const statusArea = element("div", { className: "topbar-status" });
  const actions = element("div", { className: "topbar-actions" });

  const root = element("header", {
    className: "topbar",
    children: [
      element("div", {
        className: "topbar-heading",
        children: [eyebrow, title, description],
      }),
      element("div", {
        className: "topbar-side",
        children: [statusArea, actions],
      }),
    ],
  });

  let statusKey = "";

  const unsubscribe = store.subscribe((state) => {
    const summary = hostStatusSummary(state);
    const running = state.vms.filter((vm) => vm.state === "running").length;
    const key = `${summary.label}|${summary.tone}|${summary.title}|${running}`;

    if (key === statusKey) {
      return;
    }

    statusKey = key;
    const indicators = [statusIndicator(summary)];

    if (running > 0) {
      indicators.push(
        statusIndicator({
          label: `${formatCount(running)} running`,
          tone: "ok",
          title: "Machines with a live QEMU process.",
        }),
      );
    }

    statusArea.replaceChildren(...indicators);
  });

  function setPageHeader({
    eyebrow: eyebrowText = "Workspace",
    title: titleText = "Wave VM",
    description: descriptionText = "",
    actions: actionNodes = [],
  }) {
    eyebrow.textContent = eyebrowText;
    eyebrow.hidden = !eyebrowText;
    title.textContent = titleText;
    description.textContent = descriptionText;
    description.hidden = !descriptionText;

    const nodes = Array.isArray(actionNodes) ? actionNodes : [actionNodes];
    actions.replaceChildren(...nodes.filter(Boolean));
    document.title = `${titleText} · Wave VM`;
  }

  return {
    element: root,
    setPageHeader,
    destroy() {
      unsubscribe();
    },
  };
}
