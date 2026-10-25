import { element } from "../utils/dom.js";
import { icon } from "./icons.js";

let modalCounter = 0;

export function openModal({
  title,
  description = "",
  content,
  actions = [],
  initialFocus = null,
  onClose = null,
  className = "",
}) {
  modalCounter += 1;
  const titleId = `wavevm-modal-title-${modalCounter}`;
  const descriptionId = `wavevm-modal-description-${modalCounter}`;

  const closeButton = element("button", {
    className: "button button-ghost button-icon modal-close",
    attrs: {
      type: "button",
      "aria-label": "Close dialog",
    },
    children: [icon("close", 18)],
  });

  const header = element("div", {
    className: "modal-header",
    children: [
      element("div", {
        className: "modal-heading",
        children: [
          element("h2", {
            className: "modal-title",
            text: title,
            attrs: { id: titleId },
          }),
          description
            ? element("p", {
                className: "modal-description",
                text: description,
                attrs: { id: descriptionId },
              })
            : null,
        ],
      }),
      closeButton,
    ],
  });

  const body = element("div", {
    className: "modal-body",
    children: [content],
  });

  const footer = actions.length
    ? element("div", {
        className: "modal-footer",
        children: actions,
      })
    : null;

  const dialog = element("dialog", {
    className: `modal ${className}`.trim(),
    attrs: {
      "aria-labelledby": titleId,
      "aria-describedby": description ? descriptionId : null,
    },
    children: [header, body, footer],
  });

  let closed = false;
  let dismissible = true;

  function onKeyDown(event) {
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      close("escape");
    }
  }

  function onCancel(event) {
    event.preventDefault();
    close("cancel");
  }

  function onBackdropClick(event) {
    if (event.target === dialog) {
      close("backdrop");
    }
  }

  function close(reason = "dismiss", { force = false } = {}) {
    if (closed || (!dismissible && !force)) {
      return;
    }

    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    dialog.removeEventListener("cancel", onCancel);
    dialog.removeEventListener("click", onBackdropClick);

    try {
      dialog.close();
    } catch {
      // The dialog may already be closed by the browser.
    }

    dialog.remove();
    onClose?.(reason);
  }

  closeButton.addEventListener("click", () => close("button"));
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("click", onBackdropClick);
  document.addEventListener("keydown", onKeyDown);

  document.body.append(dialog);
  dialog.showModal();
  initialFocus?.focus();

  return {
    element: dialog,
    body,
    footer,
    close,
    forceClose(reason = "forced") {
      close(reason, { force: true });
    },
    setDismissible(value) {
      dismissible = Boolean(value);
      closeButton.disabled = !dismissible;
    },
    isOpen() {
      return !closed;
    },
  };
}
