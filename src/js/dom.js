export function element(tag, options = {}) {
  const { className, text, attrs = {}, children = [] } = options;
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text !== undefined && text !== null) {
    node.textContent = String(text);
  }

  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    node.setAttribute(name, value === true ? "" : String(value));
  }

  for (const child of children) {
    if (child) {
      node.append(child);
    }
  }

  return node;
}

export function clear(node) {
  node.replaceChildren();
}

export function text(value, fallback = "Unavailable") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}
