import { element } from "../utils/dom.js";

export function createPanel({
  title,
  description = "",
  actions = [],
  body,
  wide = false,
  className = "",
}) {
  const actionNodes = Array.isArray(actions) ? actions : [actions];
  const classes = ["panel"];

  if (wide) {
    classes.push("panel-wide");
  }

  if (className) {
    classes.push(className);
  }

  const header = element("div", {
    className: "panel-header",
    children: [
      element("div", {
        className: "panel-heading",
        children: [
          element("h2", { className: "panel-title", text: title }),
          description
            ? element("p", {
                className: "panel-description",
                text: description,
              })
            : null,
        ],
      }),
      actionNodes.length
        ? element("div", {
            className: "panel-actions",
            children: actionNodes,
          })
        : null,
    ],
  });

  const bodyChildren = Array.isArray(body) ? body : [body];

  return element("section", {
    className: classes.join(" "),
    children: [
      header,
      element("div", {
        className: "panel-body",
        children: bodyChildren,
      }),
    ],
  });
}
