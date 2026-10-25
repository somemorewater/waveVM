import { invoke } from "./tauri.js";

export function getAppInfo() {
  return invoke("get_app_info");
}
