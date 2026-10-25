import { invoke } from "./tauri.js";

export function detectHost() {
  return invoke("detect_host");
}
