import { element } from "../utils/dom.js";
import { createSidebar } from "./sidebar.js";
import { createTopbar } from "./topbar.js";

export function createAppShell({ store }) {
  const sidebar = createSidebar({ store });
  const topbar = createTopbar({ store });

  const outlet = element("main", {
    className: "page-outlet",
    attrs: {
      id: "main-content",
      tabindex: "-1",
    },
  });

  const footer = element("footer", {
    className: "page-footer",
    children: [
      element("span", {
        className: "footer-brand",
        children: [
          element("img", {
            attrs: {
              src: "./assets/brand/wave-vm-symbol-navy.svg",
              alt: "",
              width: 14,
              height: 14,
            },
          }),
          element("span", { text: "Wave VM · local-first virtualization" }),
        ],
      }),
      element("span", { text: "Built with Tauri 2 and Rust" }),
    ],
  });

  const mainColumn = element("div", {
    className: "main-column",
    children: [topbar.element, outlet, footer],
  });

  const root = element("div", {
    className: "app-shell",
    children: [sidebar.element, mainColumn],
  });

  return {
    root,
    outlet,
    setActive: sidebar.setActive,
    setPageHeader: topbar.setPageHeader,
    focusOutlet() {
      outlet.focus({ preventScroll: true });
    },
    destroy() {
      sidebar.destroy();
      topbar.destroy();
    },
  };
}
