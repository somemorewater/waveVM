import { buttonLink } from "../../components/button.js";
import { icon } from "../../components/icons.js";
import { sectionHeading } from "../../components/section.js";
import { statusIndicator } from "../../components/status-indicator.js";
import { element } from "../../utils/dom.js";

export function createInstallationMediaPage({ setPageHeader }) {
  const planned = [
    {
      icon: "folder",
      title: "Select local ISO images",
      description:
        "Choose an ISO already stored on this computer and attach it to a machine as installation media.",
    },
    {
      icon: "shield",
      title: "Verify image integrity",
      description:
        "Check checksums or signatures when trustworthy verification data is available.",
    },
    {
      icon: "download",
      title: "Download from trusted sources",
      description:
        "Retrieve operating system images from documented, reputable sources rather than bundling guest images.",
    },
    {
      icon: "machines",
      title: "Attach media to a machine",
      description:
        "Boot a machine from installation media without including complete guest operating systems in the installer.",
    },
  ];

  const hero = element("section", {
    className: "media-hero",
    children: [
      element("div", {
        className: "media-hero-copy",
        children: [
          element("p", { className: "eyebrow", text: "Planned feature" }),
          element("h2", {
            text: "Installation media is not available yet.",
          }),
          element("p", {
            className: "media-hero-description",
            text: "Wave VM does not yet manage ISO images, download operating systems, or attach boot media to a machine. This page describes the intended feature without pretending it works.",
          }),
          element("div", {
            className: "media-status",
            children: [
              statusIndicator({
                label: "Not available in this build",
                tone: "neutral",
              }),
              buttonLink({
                label: "Go to virtual machines",
                href: "#/machines",
                variant: "ghost",
              }),
            ],
          }),
        ],
      }),
      element("div", {
        className: "media-hero-art",
        attrs: { "aria-hidden": "true" },
        children: [
          element("span", {
            className: "media-hero-icon",
            children: [icon("media", 56)],
          }),
          element("span", {
            className: "media-hero-art-label",
            text: "ISO / installation media",
          }),
        ],
      }),
    ],
  });

  const plannedGrid = element("div", {
    className: "media-planned-grid",
    children: planned.map((item) =>
      element("article", {
        className: "media-feature",
        children: [
          element("span", {
            className: "media-feature-icon",
            children: [icon(item.icon, 22)],
          }),
          element("div", {
            className: "media-feature-head",
            children: [
              element("h3", { text: item.title }),
              statusIndicator({ label: "Planned", tone: "neutral" }),
            ],
          }),
          element("p", { text: item.description }),
        ],
      }),
    ),
  });

  const page = element("div", {
    className: "page-stack",
    children: [
      hero,
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Roadmap",
            title: "What this feature will support",
            description:
              "These capabilities are planned. None of them is implemented in this build.",
          }),
          plannedGrid,
        ],
      }),
      element("section", {
        className: "page-section",
        children: [
          sectionHeading({
            eyebrow: "Scope",
            title: "Current installation support",
            description:
              "Wave VM is honest about the boundary between working lifecycle code and future guest installation.",
          }),
          element("div", {
            className: "scope-grid",
            children: [
              element("article", {
                className: "scope-card",
                children: [
                  element("h3", { text: "Works today" }),
                  element("ul", {
                    className: "scope-list scope-list-ready",
                    children: [
                      "Create machine definitions with validated resources",
                      "Create blank QCOW2 disks with qemu-img",
                      "Start and stop a real QEMU process",
                      "Control lifecycle operations through QMP",
                      "Persist configuration locally and atomically",
                    ].map((item) => element("li", { text: item })),
                  }),
                ],
              }),
              element("article", {
                className: "scope-card scope-card-muted",
                children: [
                  element("h3", { text: "Not available yet" }),
                  element("ul", {
                    className: "scope-list",
                    children: [
                      "ISO selection and media catalogues",
                      "Image downloads and checksum verification",
                      "Booting a guest operating system",
                      "Attaching installation media to a machine",
                    ].map((item) => element("li", { text: item })),
                  }),
                ],
              }),
            ],
          }),
          element("aside", {
            className: "inline-note",
            children: [
              element("strong", { text: "No guest images are bundled" }),
              element("p", {
                text: "Wave VM will not include complete guest operating system images in the installer. Media management must be implemented and verified before it appears here as a working control.",
              }),
            ],
          }),
        ],
      }),
    ],
  });

  setPageHeader({
    eyebrow: "Workspace",
    title: "Installation media",
    description:
      "ISO images and installation media for guest operating systems.",
  });

  return {
    element: page,
    destroy() {},
  };
}
