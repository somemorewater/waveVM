import { element, text } from "../utils/dom.js";

export function createDetailList(rows) {
  return element("dl", {
    className: "detail-list",
    children: rows.map(detailRow),
  });
}

export function detailRow({ label, value, code = false, muted = false }) {
  let content;

  if (value instanceof Node) {
    content = value;
  } else if (code) {
    content = element("code", { text: text(value) });
  } else {
    content = document.createTextNode(text(value));
  }

  return element("div", {
    className: "detail-row",
    children: [
      element("dt", { text: label }),
      element("dd", {
        className: muted ? "is-muted" : "",
        children: [content],
      }),
    ],
  });
}
