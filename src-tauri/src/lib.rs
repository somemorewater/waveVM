mod commands;
mod config;
mod error;
mod host;
mod qemu;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(state::AppState::initialize(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::host::detect_host
        ])
        .run(tauri::generate_context!())
        .expect("error while running Wave VM");
}
