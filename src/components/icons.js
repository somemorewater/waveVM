const ICONS = {
  dashboard:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7"/>',
  machines:
    '<rect x="3.5" y="5" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 20h8M12 17v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  storage:
    '<ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" stroke-width="1.7"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" stroke="currentColor" stroke-width="1.7"/>',
  media:
    '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 3.5v3M20.5 12h-3M12 20.5v-3M3.5 12h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  settings:
    '<path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h10M18 17h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="7" r="2" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="12" r="2" stroke="currentColor" stroke-width="1.7"/><circle cx="16" cy="17" r="2" stroke="currentColor" stroke-width="1.7"/>',
  plus:
    '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  refresh:
    '<path d="M20 11a8 8 0 1 0-2.3 5.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 5v6h-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  play:
    '<path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/>',
  stop:
    '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  arrowLeft:
    '<path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowRight:
    '<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close:
    '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  check:
    '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  info:
    '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  warning:
    '<path d="M12 4.5 21 20H3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  folder:
    '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  cpu:
    '<rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  memory:
    '<rect x="3.5" y="7" width="17" height="10" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M7 10v4M10.5 10v4M14 10v4M17.5 10v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  shield:
    '<path d="M12 3.5 19 6v5.5c0 4.2-2.8 7.4-7 9-4.2-1.6-7-4.8-7-9V6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  download:
    '<path d="M12 4v10M8 10l4 4 4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  maximize:
    '<path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  minimize:
    '<path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  mouse:
    '<rect x="7" y="3" width="10" height="18" rx="5" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

export function icon(name, size = 18, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icon");

  if (className) {
    svg.classList.add(className);
  }

  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}
