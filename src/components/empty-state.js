import { element } from "../utils/dom.js";

let emptyStateCounter = 0;

export function createEmptyState({
  eyebrow = "Empty",
  title,
  description,
  facts = [],
  actions = [],
  art = true,
  artCaption = "Ride your own systems.",
  artMeta = "Local-first virtualization",
}) {
  emptyStateCounter += 1;
  const titleId = `empty-state-title-${emptyStateCounter}`;

  const copy = element("div", {
    className: "empty-copy",
    children: [
      element("p", { className: "eyebrow", text: eyebrow }),
      element("h2", { text: title, attrs: { id: titleId } }),
      element("p", { text: description }),
      facts.length
        ? element("ul", {
            className: "empty-facts",
            children: facts.map((fact) => element("li", { text: fact })),
          })
        : null,
      actions.length
        ? element("div", { className: "empty-actions", children: actions })
        : null,
    ],
  });

  const children = [copy];

  if (art) {
    children.push(
      element("div", {
        className: "empty-art",
        attrs: { "aria-hidden": "true" },
        children: [
          element("img", {
            className: "empty-art-symbol",
            attrs: {
              src: "./assets/brand/wave-vm-symbol-white.svg",
              alt: "",
              width: 64,
              height: 64,
            },
          }),
          element("span", { className: "empty-art-caption", text: artCaption }),
          element("span", { className: "empty-art-meta", text: artMeta }),
        ],
      }),
    );
  }

  return element("section", {
    className: art ? "empty-state" : "empty-state is-plain",
    attrs: { "aria-labelledby": titleId },
    children,
  });
}
