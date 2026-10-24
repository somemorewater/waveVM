import { detectHost, getAppInfo, normalizeError } from "./api.js";
import { clear } from "./dom.js";
import { renderAppMeta, renderHost, renderHostError, renderLoading } from "./host-view.js";

const refs = {
  panel: document.querySelector("#host-panel"),
  summary: document.querySelector("#host-summary"),
  alertRegion: document.querySelector("#global-alert"),
  refreshButton: document.querySelector("#refresh-host"),
  refreshLabel: document.querySelector("#refresh-label"),
  appVersion: document.querySelector("#app-version"),
};

let refreshing = false;

const navLinks = [...document.querySelectorAll(".nav-link")];

function setActiveNav(activeLink) {
  for (const link of navLinks) {
    const isActive = link === activeLink;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

for (const link of navLinks) {
  link.addEventListener("click", () => setActiveNav(link));
}

const initialLink = navLinks.find((link) => link.getAttribute("href") === window.location.hash);
if (initialLink) {
  setActiveNav(initialLink);
}

async function refresh() {
  if (refreshing) {
    return;
  }

  refreshing = true;
  setBusy(true);
  clear(refs.alertRegion);
  renderLoading(refs.panel, refs.summary);
  refs.panel.setAttribute("aria-busy", "true");

  const [hostResult, infoResult] = await Promise.allSettled([
    detectHost(),
    getAppInfo(),
  ]);

  const appInfo = infoResult.status === "fulfilled" ? infoResult.value : null;
  const appInfoError =
    infoResult.status === "rejected" ? normalizeError(infoResult.reason) : null;

  if (appInfo) {
    renderAppMeta(refs.appVersion, appInfo);
  }

  try {
    if (hostResult.status === "fulfilled") {
      renderHost(refs.panel, hostResult.value, appInfo, appInfoError);
    } else {
      renderHostError(
        refs.panel,
        normalizeError(hostResult.reason),
        refs.alertRegion,
        appInfoError,
      );
    }
  } catch (error) {
    renderHostError(refs.panel, normalizeError(error), refs.alertRegion, appInfoError);
  }

  refreshing = false;
  setBusy(false);
}

function setBusy(isBusy) {
  refs.refreshButton.disabled = isBusy;
  refs.refreshLabel.textContent = isBusy ? "Checking…" : "Recheck host";
  if (!isBusy) {
    refs.panel.setAttribute("aria-busy", "false");
  }
}

refs.refreshButton.addEventListener("click", refresh);
refresh();
