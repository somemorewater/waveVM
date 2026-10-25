import { element } from "../utils/dom.js";
import { icon } from "./icons.js";

export function createSidebar({ store }) {
  const links = new Map();
  const version = element("span", { text: "v0.1.0" });

  function navLink({ nav, href, label, iconName }) {
    const link = element("a", {
      className: "nav-link",
      attrs: { href: `#${href}` },
      children: [
        icon(iconName, 18, "nav-icon"),
        element("span", { text: label }),
      ],
    });
    links.set(nav, link);
    return link;
  }

  const root = element("aside", {
    className: "sidebar",
    children: [
      element("a", {
        className: "sidebar-brand",
        attrs: { href: "#/dashboard", "aria-label": "Wave VM dashboard" },
        children: [
          element("img", {
            className: "brand-wordmark",
            attrs: {
              src: "./assets/brand/wave-vm-wordmark-white.svg",
              alt: "",
              width: 344,
              height: 84,
            },
          }),
          element("span", {
            className: "brand-tagline",
            text: "Ride your own systems.",
          }),
        ],
      }),
      element("nav", {
        className: "sidebar-nav",
        attrs: { "aria-label": "Primary" },
        children: [
          element("p", { className: "sidebar-nav-label", text: "Workspace" }),
          navLink({
            nav: "dashboard",
            href: "/dashboard",
            label: "Dashboard",
            iconName: "dashboard",
          }),
          navLink({
            nav: "machines",
            href: "/machines",
            label: "Virtual machines",
            iconName: "machines",
          }),
          navLink({
            nav: "storage",
            href: "/storage",
            label: "Storage",
            iconName: "storage",
          }),
          navLink({
            nav: "media",
            href: "/media",
            label: "Installation media",
            iconName: "media",
          }),
        ],
      }),
      element("div", { className: "sidebar-spacer" }),
      element("div", {
        className: "sidebar-note",
        children: [
          element("span", { className: "sidebar-note-dot", attrs: { "aria-hidden": "true" } }),
          element("span", {
            children: [
              element("strong", { text: "Local only" }),
              element("span", { text: "No account. No cloud." }),
            ],
          }),
        ],
      }),
      element("nav", {
        className: "sidebar-nav sidebar-nav-secondary",
        attrs: { "aria-label": "Application" },
        children: [
          element("p", { className: "sidebar-nav-label", text: "Application" }),
          navLink({
            nav: "settings",
            href: "/settings",
            label: "Settings",
            iconName: "settings",
          }),
        ],
      }),
      element("div", {
        className: "sidebar-footer",
        children: [version, element("span", { text: "Local desktop" })],
      }),
    ],
  });

  const unsubscribe = store.subscribe((state) => {
    version.textContent = state.appInfo?.version
      ? `v${state.appInfo.version}`
      : "v0.1.0";
  });

  function setActive(navId) {
    for (const [nav, link] of links) {
      const active = nav === navId;
      link.classList.toggle("is-active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  return {
    element: root,
    setActive,
    destroy() {
      unsubscribe();
    },
  };
}
