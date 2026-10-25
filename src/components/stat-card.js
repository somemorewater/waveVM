import { element } from "../utils/dom.js";
import { icon } from "./icons.js";

export function createStatCard({
  label,
  value,
  detail,
  iconName = null,
  tone = "neutral",
  loading = false,
}) {
  return element("article", {
    className: "stat-card",
    attrs: { "data-tone": tone },
    children: [
      element("div", {
        className: "stat-card-head",
        children: [
          element("span", { className: "stat-label", text: label }),
          iconName
            ? element("span", {
                className: "stat-icon",
                children: [icon(iconName, 18)],
              })
            : null,
        ],
      }),
      element("p", {
        className: "stat-value",
        text: loading ? "—" : value,
        attrs: loading ? { "aria-label": "Loading" } : {},
      }),
      element("p", {
        className: "stat-detail",
        text: loading ? "Loading from the backend…" : detail,
      }),
    ],
  });
}
