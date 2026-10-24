export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

function invoke(command, args) {
  const tauri = window.__TAURI__;

  if (!tauri || !tauri.core || typeof tauri.core.invoke !== "function") {
    return Promise.reject(
      new ApiError(
        "desktop_shell_required",
        "Wave VM must be opened through its desktop shell. Start it with `npm run dev`.",
      ),
    );
  }

  return tauri.core.invoke(command, args);
}

export function detectHost() {
  return invoke("detect_host");
}

export function getAppInfo() {
  return invoke("get_app_info");
}

export function normalizeError(error) {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }

  if (typeof error === "string") {
    return { code: "request_failed", message: error };
  }

  if (error && typeof error === "object") {
    const message =
      typeof error.message === "string" ? error.message : "The backend returned an unexpected error.";
    const code = typeof error.code === "string" ? error.code : "request_failed";
    return { code, message };
  }

  if (error instanceof Error) {
    return { code: "request_failed", message: error.message };
  }

  return {
    code: "unknown_error",
    message: "An unexpected error occurred while contacting the Wave VM backend.",
  };
}
