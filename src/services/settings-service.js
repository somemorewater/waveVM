const THEME_STORAGE_KEY = "wavevm.theme";
const VALID_THEMES = new Set(["system", "light", "dark"]);

export const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

let mediaQuery = null;
let mediaListener = null;

function readStoredTheme() {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return VALID_THEMES.has(value) ? value : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveTheme(preference) {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return systemPrefersDark() ? "dark" : "light";
}

export function getThemePreference() {
  return readStoredTheme();
}

export function applyTheme(preference = getThemePreference()) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  return resolved;
}

export function setThemePreference(preference) {
  const next = VALID_THEMES.has(preference) ? preference : "system";

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // The preference remains active for this session when storage is unavailable.
  }

  applyTheme(next);
  return next;
}

export function initTheme() {
  applyTheme();

  if (typeof window.matchMedia !== "function") {
    return () => {};
  }

  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaListener = () => {
    if (getThemePreference() === "system") {
      applyTheme("system");
    }
  };

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", mediaListener);
    return () => mediaQuery.removeEventListener("change", mediaListener);
  }

  if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(mediaListener);
    return () => mediaQuery.removeListener(mediaListener);
  }

  return () => {};
}
