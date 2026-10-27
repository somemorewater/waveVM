import { invoke } from "./tauri.js";

export function setWindowFullscreen(fullscreen) {
  return invoke("set_window_fullscreen", { fullscreen });
}

export function getWindowFullscreen() {
  return invoke("get_window_fullscreen");
}
