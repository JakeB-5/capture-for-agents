mod capture;
mod macos;

use std::process::Command;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SHORTCUT_LABEL: &str = "⌥⇧C";

#[derive(Default)]
struct AppState {
    prev_app_pid: Mutex<Option<i32>>,
    capturing: Mutex<bool>,
    shortcut_registered: Mutex<bool>,
}

/// Remember the frontmost app, run interactive screencapture on a worker
/// thread, then notify the webview. Re-entry while a capture is in flight is
/// ignored (the shortcut still fires while screencapture's crosshair is up).
fn trigger_capture(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        {
            let mut capturing = state.capturing.lock().unwrap();
            if *capturing {
                return;
            }
            *capturing = true;
        }

        *state.prev_app_pid.lock().unwrap() = macos::frontmost_app_pid();
        let result = capture::run_interactive_capture();
        *state.capturing.lock().unwrap() = false;

        match result {
            Ok(capture::CaptureOutcome::Captured(path)) => {
                let _ = app.emit("capture-done", path.to_string_lossy().to_string());
            }
            Ok(capture::CaptureOutcome::Cancelled) => {}
            Err(capture::CaptureError::TccDenied(msg)) => {
                show_window_with_size(&app, 560.0, 420.0);
                let _ = app.emit("capture-tcc-denied", msg);
            }
            Err(e) => {
                show_window_with_size(&app, 560.0, 420.0);
                let _ = app.emit("capture-error", e.to_string());
            }
        }
    });
}

fn show_window_with_size(app: &AppHandle, width: f64, height: f64) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(tauri::LogicalSize::new(width, height));
        let _ = win.center();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn hide_and_restore(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    if let Some(pid) = *app.state::<AppState>().prev_app_pid.lock().unwrap() {
        macos::activate_pid(pid);
    }
}

#[tauri::command]
fn show_capture_window(app: AppHandle, width: f64, height: f64) {
    show_window_with_size(&app, width, height);
}

/// Invariant 1: the clipboard carries text only — never image data.
#[tauri::command]
fn copy_path_and_restore(app: AppHandle, path: String) -> Result<(), String> {
    app.clipboard().write_text(path).map_err(|e| e.to_string())?;
    hide_and_restore(&app);
    Ok(())
}

#[tauri::command]
fn dismiss_window(app: AppHandle) {
    hide_and_restore(&app);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    shortcut_registered: bool,
    shortcut_label: String,
}

#[tauri::command]
fn get_app_status(app: AppHandle) -> AppStatus {
    AppStatus {
        shortcut_registered: *app.state::<AppState>().shortcut_registered.lock().unwrap(),
        shortcut_label: SHORTCUT_LABEL.into(),
    }
}

#[tauri::command]
fn run_test_capture() -> Result<capture::TestCaptureReport, String> {
    capture::run_test_capture().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_screen_recording_settings() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            show_capture_window,
            copy_path_and_restore,
            dismiss_window,
            get_app_status,
            run_test_capture,
            open_screen_recording_settings,
        ])
        .setup(|app| {
            // Menubar-resident: no dock icon, no app switcher entry.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let capture_i = MenuItem::with_id(
                app,
                "capture",
                format!("Capture ({SHORTCUT_LABEL})"),
                true,
                None::<&str>,
            )?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&capture_i, &PredefinedMenuItem::separator(app)?, &quit_i],
            )?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "capture" => trigger_capture(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let shortcut = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyC);
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, sc, event| {
                        if sc == &shortcut && event.state() == ShortcutState::Pressed {
                            trigger_capture(app);
                        }
                    })
                    .build(),
            )?;
            // Registration can fail (key taken by another app). The tray menu
            // stays as the capture fallback; the webview shows a banner.
            let registered = app.global_shortcut().register(shortcut).is_ok();
            *app.state::<AppState>().shortcut_registered.lock().unwrap() = registered;
            if !registered {
                eprintln!("warning: failed to register global shortcut {SHORTCUT_LABEL}");
            }

            // Closing the capture window hides it; the app stays resident.
            if let Some(win) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_and_restore(&app_handle);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
