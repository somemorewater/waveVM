import { element } from "../utils/dom.js";
import { warningLabel } from "../utils/format.js";

export function createAlertStack(className = "alert-stack") {
  return element("div", {
    className,
    attrs: { "aria-live": "polite" },
  });
}

export function clearAlerts(container) {
  if (container) {
    container.replaceChildren();
  }
}

export function appendAlert(
  container,
  { severity = "info", title = "Notice", message = "", code = null },
) {
  if (!container) {
    return null;
  }

  const detail = code ? `${message} (${code})` : message;
  const node = element("div", {
    className: "alert",
    attrs: {
      "data-severity": severity,
      role: severity === "error" ? "alert" : "status",
    },
    children: [
      element("span", {
        className: "alert-label",
        text: warningLabel(severity),
      }),
      element("div", {
        className: "alert-copy",
        children: [
          element("span", { className: "alert-title", text: title }),
          element("span", {
            className: "alert-message",
            text: detail || "No additional detail was provided.",
          }),
        ],
      }),
    ],
  });

  container.append(node);
  return node;
}
