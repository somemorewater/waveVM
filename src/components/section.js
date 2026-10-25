import { element } from "../utils/dom.js";

export function sectionHeading({ eyebrow, title, description, actions = [], id = null }) {
  const copy = element("div", {
    className: "section-heading-copy",
    children: [
      eyebrow ? element("p", { className: "eyebrow", text: eyebrow }) : null,
      element("h2", { text: title, attrs: id ? { id } : {} }),
      description
        ? element("p", { className: "section-description", text: description })
        : null,
    ],
  });

  const actionNodes = Array.isArray(actions) ? actions : [actions];
  const actionArea = actionNodes.length
    ? element("div", {
        className: "section-heading-actions",
        children: actionNodes,
      })
    : null;

  return element("div", {
    className: "section-heading",
    children: [copy, actionArea],
  });
}
