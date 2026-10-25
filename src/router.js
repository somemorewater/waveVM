const DEFAULT_PATH = "/dashboard";

const ROUTES = [
  {
    id: "dashboard",
    nav: "dashboard",
    pattern: /^\/dashboard\/?$/,
    params: [],
  },
  {
    id: "machines",
    nav: "machines",
    pattern: /^\/machines\/?$/,
    params: [],
  },
  {
    id: "vm-console",
    nav: "machines",
    pattern: /^\/machines\/([^/]+)\/console\/?$/,
    params: ["id"],
  },
  {
    id: "vm-details",
    nav: "machines",
    pattern: /^\/machines\/([^/]+)\/?$/,
    params: ["id"],
  },
  {
    id: "storage",
    nav: "storage",
    pattern: /^\/storage\/?$/,
    params: [],
  },
  {
    id: "media",
    nav: "media",
    pattern: /^\/media\/?$/,
    params: [],
  },
  {
    id: "settings",
    nav: "settings",
    pattern: /^\/settings\/?$/,
    params: [],
  },
];

function parseHash() {
  const raw = window.location.hash;
  let path = raw.startsWith("#") ? raw.slice(1) : raw;
  path = path.split("?")[0];

  if (!path) {
    return "/";
  }

  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  return path;
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const match = path.match(route.pattern);

    if (!match) {
      continue;
    }

    const params = {};

    for (let index = 0; index < route.params.length; index += 1) {
      const name = route.params[index];
      const value = match[index + 1];

      try {
        params[name] = decodeURIComponent(value);
      } catch {
        params[name] = value;
      }
    }

    return { route, params };
  }

  return null;
}

export function createRouter({ onRoute }) {
  let started = false;

  function handle() {
    const path = parseHash();

    if (path === "/") {
      replace(DEFAULT_PATH);
      return;
    }

    const matched = matchRoute(path);

    if (!matched) {
      replace(DEFAULT_PATH);
      return;
    }

    onRoute({ ...matched, path });
  }

  function onHashChange() {
    handle();
  }

  function navigate(path, { replace: replaceHistory = false } = {}) {
    const normalized = path.startsWith("/") ? path : `/${path}`;

    if (replaceHistory) {
      if (window.location.hash !== `#${normalized}`) {
        window.history.replaceState(null, "", `#${normalized}`);
      }
      handle();
      return;
    }

    if (window.location.hash === `#${normalized}`) {
      return;
    }

    window.location.hash = normalized;
  }

  function replace(path) {
    navigate(path, { replace: true });
  }

  function start() {
    if (started) {
      return;
    }

    started = true;
    window.addEventListener("hashchange", onHashChange);
    handle();
  }

  function stop() {
    started = false;
    window.removeEventListener("hashchange", onHashChange);
  }

  return {
    start,
    stop,
    navigate,
    replace,
    get current() {
      return parseHash();
    },
  };
}
