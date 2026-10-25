import { element } from "../utils/dom.js";
import { button } from "./button.js";

export function createErrorCard({
  title,
  message,
  code = null,
  onRetry = null,
  retryLabel = "Try again",
}) {
  const children = [
    element("h3", { text: title }),
    element("p", { text: message }),
    code
      ? element("p", {
          className: "error-code",
          text: `Error code: ${code}`,
        })
      : null,
  ];

  if (onRetry) {
    children.push(
      element("div", {
        className: "error-card-actions",
        children: [
          button({
            label: retryLabel,
            iconName: "refresh",
            onClick: onRetry,
          }),
        ],
      }),
    );
  }

  return element("div", {
    className: "error-card",
    children,
  });
}
