mod commands;
mod config;
mod error;
mod host;
mod qemu;
mod qmp;
mod state;
mod vm;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_permission_request(|_webview, permission| {
            if permission == tauri::webview::PermissionKind::PointerLock {
                tauri::webview::PermissionResponse::Allow
            } else {
                tauri::webview::PermissionResponse::Default
            }
        })
        .setup(|app| {
            app.manage(state::AppState::initialize(app.handle()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::host::detect_host,
            commands::vm::list_vms,
            commands::vm::create_vm,
            commands::vm::start_vm,
            commands::vm::stop_vm,
            commands::vm::get_vm_console,
            commands::vm::get_vm_logs,
            commands::vm::export_vm_log,
            commands::media::pick_iso_file,
            commands::media::set_vm_install_iso,
            commands::media::set_vm_boot_mode,
            commands::network::set_vm_network_enabled,
            commands::window::set_window_fullscreen,
            commands::window::get_window_fullscreen
        ])
        .build(tauri::generate_context!())
        .expect("error while building Wave VM");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<state::AppState>() {
                state.shutdown_all();
            }
        }
    });
}
