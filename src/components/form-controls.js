import { element } from "../utils/dom.js";

export function formField({ label, control, hint = null, wide = false }) {
  const hintNode =
    typeof hint === "string"
      ? element("span", { className: "field-hint", text: hint })
      : hint;

  return element("div", {
    className: wide ? "form-field form-field-wide" : "form-field",
    children: [
      element("label", {
        className: "field-label",
        text: label,
        attrs: { for: control.id },
      }),
      control,
      hintNode,
    ],
  });
}

export function textInput({
  id,
  name,
  value = "",
  placeholder = "",
  maxLength = null,
  autocomplete = "off",
  required = true,
}) {
  return element("input", {
    attrs: {
      id,
      name,
      type: "text",
      value,
      placeholder,
      maxlength: maxLength,
      autocomplete,
      required,
    },
  });
}

export function numberInput({
  id,
  name,
  value,
  min,
  max,
  step = 1,
  required = true,
}) {
  return element("input", {
    attrs: {
      id,
      name,
      type: "number",
      value,
      min,
      max,
      step,
      required,
    },
  });
}

export function selectInput({ id, name, options, value = "" }) {
  const select = element("select", {
    attrs: { id, name },
  });

  for (const option of options) {
    const node = element("option", {
      text: option.label,
      attrs: {
        value: option.value,
        selected: option.value === value,
      },
    });
    select.append(node);
  }

  return select;
}

export function formNote(message) {
  return element("p", { className: "form-note", text: message });
}

export function formActions(children) {
  return element("div", { className: "form-actions", children });
}
