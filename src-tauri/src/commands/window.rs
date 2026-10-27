use crate::error::AppError;

#[tauri::command]
pub fn set_window_fullscreen(window: tauri::Window, fullscreen: bool) -> Result<(), AppError> {
    window
        .set_fullscreen(fullscreen)
        .map_err(|error| AppError::Window(error.to_string()))
}

#[tauri::command]
pub fn get_window_fullscreen(window: tauri::Window) -> Result<bool, AppError> {
    window
        .is_fullscreen()
        .map_err(|error| AppError::Window(error.to_string()))
}
