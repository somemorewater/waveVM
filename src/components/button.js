import { element } from "../utils/dom.js";
import { icon } from "./icons.js";

export function button({
  label = "",
  iconName = null,
  variant = "",
  small = false,
  type = "button",
  disabled = false,
  onClick = null,
  ariaLabel = null,
  title = null,
  attrs = {},
}) {
  const classes = ["button"];

  if (variant) {
    classes.push(`button-${variant}`);
  }

  if (small) {
    classes.push("button-small");
  }

  if (!label) {
    classes.push("button-icon");
  }

  const node = element("button", {
    className: classes.join(" "),
    attrs: {
      type,
      disabled,
      "aria-label": ariaLabel,
      title,
      ...attrs,
    },
    children: [
      iconName ? icon(iconName, small ? 14 : 16) : null,
      label ? element("span", { text: label }) : null,
    ],
  });

  if (onClick) {
    node.addEventListener("click", onClick);
  }

  return node;
}

export function buttonLink({
  label,
  href,
  iconName = null,
  variant = "",
  small = false,
  className = "",
  title = null,
}) {
  const classes = ["button"];

  if (variant) {
    classes.push(`button-${variant}`);
  }

  if (small) {
    classes.push("button-small");
  }

  if (className) {
    classes.push(className);
  }

  return element("a", {
    className: classes.join(" "),
    attrs: { href, title },
    children: [
      iconName ? icon(iconName, small ? 14 : 16) : null,
      element("span", { text: label }),
    ],
  });
}
