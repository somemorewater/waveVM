import { createAppShell } from "./components/app-shell.js";
import { buttonLink } from "./components/button.js";
import { createDashboardPage } from "./pages/dashboard/dashboard-page.js";
import { createInstallationMediaPage } from "./pages/installation-media/media-page.js";
import { createSettingsPage } from "./pages/settings/settings-page.js";
import { createStoragePage } from "./pages/storage/storage-page.js";
import { createVirtualMachinesPage } from "./pages/virtual-machines/virtual-machines-page.js";
import { createVmConsolePage } from "./pages/virtual-machines/vm-console-page.js";
import { createVmDetailsPage } from "./pages/virtual-machines/vm-details-page.js";
import { createVmLogsPage } from "./pages/virtual-machines/vm-logs-page.js";
import { createRouter } from "./router.js";
import { initTheme } from "./services/settings-service.js";
import { createAppStore } from "./state/app-store.js";
import { element } from "./utils/dom.js";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Wave VM could not find its application mount point.");
}

initTheme();

const store = createAppStore();
const shell = createAppShell({ store });
root.append(shell.root);

let currentPage = null;
let router;

function renderFallback(error) {
  console.error("Wave VM page failed to render", error);
  shell.setPageHeader({
    eyebrow: "Application",
    title: "Page unavailable",
    description: "The requested page could not be rendered.",
    actions: [
      buttonLink({
        label: "Go to dashboard",
        href: "#/dashboard",
      }),
    ],
  });

  return {
    element: element("div", {
      className: "error-card",
      children: [
        element("h3", { text: "This page could not be rendered" }),
        element("p", {
          text:
            error instanceof Error
              ? error.message
              : "An unexpected frontend error occurred.",
        }),
        element("p", {
          className: "error-code",
          text: "The rest of the application remains available.",
        }),
      ],
    }),
    destroy() {},
  };
}

router = createRouter({
  onRoute({ route, params }) {
    try {
      currentPage?.destroy?.();
    } catch (error) {
      console.error("Wave VM page cleanup failed", error);
    }

    currentPage = null;
    shell.outlet.replaceChildren();
    shell.setActive(route.nav);

    const context = {
      store,
      navigate: (path, options) => router.navigate(path, options),
      setPageHeader: shell.setPageHeader,
    };

    let page;

    try {
      switch (route.id) {
        case "dashboard":
          page = createDashboardPage(context);
          break;
        case "machines":
          page = createVirtualMachinesPage(context);
          break;
        case "vm-console":
          page = createVmConsolePage(context, params.id);
          break;
        case "vm-logs":
          page = createVmLogsPage(context, params.id);
          break;
        case "vm-details":
          page = createVmDetailsPage(context, params.id);
          break;
        case "storage":
          page = createStoragePage(context);
          break;
        case "media":
          page = createInstallationMediaPage(context);
          break;
        case "settings":
          page = createSettingsPage(context);
          break;
        default:
          throw new Error(`Unknown route: ${route.id}`);
      }
    } catch (error) {
      page = renderFallback(error);
    }

    currentPage = page;
    shell.outlet.append(page.element);
    window.scrollTo(0, 0);
    shell.focusOutlet();
  },
});

store.initialize();
router.start();

window.addEventListener("beforeunload", () => {
  currentPage?.destroy?.();
  store.destroy();
  shell.destroy();
});
