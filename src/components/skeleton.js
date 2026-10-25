import { element } from "../utils/dom.js";

export function skeletonCard({ lines = 3 } = {}) {
  const children = [
    element("span", { className: "skeleton-line skeleton-line-short" }),
  ];

  for (let index = 1; index < lines; index += 1) {
    children.push(
      element("span", {
        className:
          index === lines - 1
            ? "skeleton-line skeleton-line-medium"
            : "skeleton-line",
      }),
    );
  }

  return element("div", {
    className: "skeleton-card",
    attrs: { "aria-hidden": "true" },
    children,
  });
}

export function skeletonGrid(count = 2) {
  return element("div", {
    className: "skeleton-grid",
    attrs: { "aria-hidden": "true" },
    children: Array.from({ length: count }, () => skeletonCard()),
  });
}
