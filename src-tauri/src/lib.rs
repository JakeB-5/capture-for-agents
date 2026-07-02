mod capture;
mod macos;
mod settings;

use std::path::Path;
use std::process::Command;
use std::sync::Mutex;

use base64::Engine;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Default)]
struct AppState {
    prev_app_pid: Mutex<Option<i32>>,
    capturing: Mutex<bool>,
    shortcut_registered: Mutex<bool>,
}

struct SettingsState {
    settings: Mutex<settings::Settings>,
}

/// Payload for the "capture-done" event emitted to the webview.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CaptureDonePayload {
    path: String,
    scale: u32,
    /// True when reopening a committed capture from History — ESC must then
    /// close without deleting the PNG (past CapNote blocks reference it).
    reannotate: bool,
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

        // Read the configured capture dir at call time so settings changes take effect.
        let dir = {
            let ss = app.state::<SettingsState>();
            let s = ss.settings.lock().unwrap();
            settings::resolved_capture_dir(&s)
        };

        let result = capture::run_interactive_capture(&dir);
        *state.capturing.lock().unwrap() = false;

        match result {
            Ok(capture::CaptureOutcome::Captured { path, scale }) => {
                let _ = app.emit(
                    "capture-done",
                    CaptureDonePayload {
                        path: path.to_string_lossy().to_string(),
                        scale,
                        reannotate: false,
                    },
                );
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
fn copy_text_and_restore(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())?;
    hide_and_restore(&app);
    Ok(())
}

/// Read the raw capture for the annotator, as base64. Loading via the asset
/// protocol is cross-origin to the webview and taints the canvas, which
/// blocks toBlob() at commit — a same-origin data: URL avoids that entirely.
#[tauri::command]
fn load_capture_png(app: AppHandle, path: String) -> Result<String, String> {
    let dir = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        settings::resolved_capture_dir(&s)
    };
    let p = std::path::Path::new(&path);
    if !capture::is_capnote_png(&dir, p) {
        return Err(format!("path is not a capnote PNG: {path}"));
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Overwrite the raw capture with the burned-in, downscaled PNG produced by
/// the webview. `data_base64` is standard base64 of the PNG bytes.
#[tauri::command]
fn save_annotated_png(app: AppHandle, path: String, data_base64: String) -> Result<(), String> {
    let dir = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        settings::resolved_capture_dir(&s)
    };
    let p = std::path::Path::new(&path);
    if !capture::is_capnote_png(&dir, p) {
        return Err(format!("path is not a capnote PNG: {path}"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    // Sanity-check magic bytes before clobbering the file.
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("decoded data is not a valid PNG".into());
    }
    std::fs::write(p, &bytes).map_err(|e| e.to_string())
}

/// Persist the CapNote block next to its PNG (same stem + ".capnote") so
/// History can re-copy it later. Refreshes the History tray submenu.
#[tauri::command]
fn save_capnote_block(app: AppHandle, path: String, block: String) -> Result<(), String> {
    let dir = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        settings::resolved_capture_dir(&s)
    };
    let p = std::path::Path::new(&path);
    if !capture::is_capnote_png(&dir, p) {
        return Err(format!("path is not a capnote PNG: {path}"));
    }
    let sidecar = p.with_extension("capnote");
    std::fs::write(&sidecar, &block).map_err(|e| e.to_string())?;
    rebuild_tray_menu(&app);
    Ok(())
}

/// ESC cancels the whole annotation: the raw capture is removed so nothing
/// is left behind (the spec says cancel saves nothing).
#[tauri::command]
fn discard_capture(app: AppHandle, path: String) -> Result<(), String> {
    let dir = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        settings::resolved_capture_dir(&s)
    };
    let p = std::path::Path::new(&path);
    if !capture::is_capnote_png(&dir, p) {
        return Err(format!("path is not a capnote PNG: {path}"));
    }
    match std::fs::remove_file(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
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
    let label = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        settings::shortcut_label(&s)
    };
    AppStatus {
        shortcut_registered: *app.state::<AppState>().shortcut_registered.lock().unwrap(),
        shortcut_label: label,
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

#[tauri::command]
fn get_settings(app: AppHandle) -> settings::Settings {
    app.state::<SettingsState>().settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: settings::Settings) -> Result<AppStatus, String> {
    // Validate: shortcut must parse.
    settings
        .shortcut
        .parse::<Shortcut>()
        .map_err(|e| format!("단축키를 인식할 수 없습니다: {e}"))?;

    // Validate: capture_dir must expand to an absolute path and be creatable.
    let dir = settings::resolved_capture_dir(&settings);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("저장 경로를 만들 수 없습니다: {e}"))?;

    // Clamp retention values (do not error).
    let clamped = settings::Settings {
        retention_days: settings.retention_days.max(1),
        retention_max: settings.retention_max.max(10),
        ..settings.clone()
    };

    // Persist to disk.
    settings::save(&app, &clamped).map_err(|e| format!("설정 저장 실패: {e}"))?;

    // Swap managed state.
    *app.state::<SettingsState>().settings.lock().unwrap() = clamped.clone();

    // Re-register shortcut: unregister all first, then register the new one.
    let new_shortcut = clamped.shortcut.parse::<Shortcut>().unwrap(); // already validated above
    let _ = app.global_shortcut().unregister_all();
    let registered = app.global_shortcut().register(new_shortcut).is_ok();
    *app.state::<AppState>().shortcut_registered.lock().unwrap() = registered;

    // Rebuild tray with updated label and dir.
    rebuild_tray_menu(&app);

    Ok(AppStatus {
        shortcut_registered: registered,
        shortcut_label: settings::shortcut_label(&clamped),
    })
}

// ── History tray helpers ────────────────────────────────────────────────────

/// Returns up to 10 .capnote sidecar stems from `dir`, newest-mtime first.
fn history_stems(dir: &Path) -> Vec<String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut files: Vec<(std::time::SystemTime, String)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("capnote") {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_owned(),
            None => continue,
        };
        let mtime = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        files.push((mtime, stem));
    }
    // Newest first.
    files.sort_unstable_by(|a, b| b.0.cmp(&a.0));
    files.into_iter().take(10).map(|(_, s)| s).collect()
}

/// Build one History entry: submenu titled STEM → ["Copy CapNote", "Re-annotate"].
/// Item IDs encode both action and stem so on_menu_event can route without state.
fn build_entry_submenu(app: &AppHandle, stem: &str) -> tauri::Result<Submenu<tauri::Wry>> {
    let copy_i = MenuItem::with_id(
        app,
        format!("hist-copy:{stem}"),
        "Copy CapNote",
        true,
        None::<&str>,
    )?;
    let reannot_i = MenuItem::with_id(
        app,
        format!("hist-reannot:{stem}"),
        "Re-annotate",
        true,
        None::<&str>,
    )?;
    Submenu::with_items(
        app,
        stem,
        true,
        &[
            &copy_i as &dyn IsMenuItem<tauri::Wry>,
            &reannot_i as &dyn IsMenuItem<tauri::Wry>,
        ],
    )
}

/// Build the full tray menu from the current disk state and settings.
fn build_tray_menu(
    app: &AppHandle,
    shortcut_label: &str,
    dir: &Path,
) -> tauri::Result<Menu<tauri::Wry>> {
    let capture_i = MenuItem::with_id(
        app,
        "capture",
        format!("Capture ({shortcut_label})"),
        true,
        None::<&str>,
    )?;
    let settings_i = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;

    let stems = history_stems(dir);
    let history_sub: Submenu<tauri::Wry> = if stems.is_empty() {
        let empty =
            MenuItem::with_id(app, "hist-empty", "No captures yet", false, None::<&str>)?;
        Submenu::with_items(app, "History", true, &[&empty as &dyn IsMenuItem<tauri::Wry>])?
    } else {
        let entries: Vec<Submenu<tauri::Wry>> = stems
            .iter()
            .map(|s| build_entry_submenu(app, s))
            .collect::<tauri::Result<_>>()?;
        let refs: Vec<&dyn IsMenuItem<tauri::Wry>> =
            entries.iter().map(|e| e as &dyn IsMenuItem<tauri::Wry>).collect();
        Submenu::with_items(app, "History", true, &refs)?
    };

    Menu::with_items(
        app,
        &[
            &capture_i as &dyn IsMenuItem<tauri::Wry>,
            &history_sub as &dyn IsMenuItem<tauri::Wry>,
            &settings_i as &dyn IsMenuItem<tauri::Wry>,
            &sep as &dyn IsMenuItem<tauri::Wry>,
            &quit_i as &dyn IsMenuItem<tauri::Wry>,
        ],
    )
}

/// Swap the tray menu for a freshly-built one; best-effort (logs on error).
fn rebuild_tray_menu(app: &AppHandle) {
    let (label, dir) = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        (settings::shortcut_label(&s), settings::resolved_capture_dir(&s))
    };
    match build_tray_menu(app, &label, &dir) {
        Ok(menu) => {
            if let Some(tray) = app.tray_by_id("main-tray") {
                if let Err(e) = tray.set_menu(Some(menu)) {
                    eprintln!("capnote: set_menu failed: {e}");
                }
            }
        }
        Err(e) => eprintln!("capnote: build_tray_menu failed: {e}"),
    }
}

/// Read the .capnote sidecar for STEM and write its text to the clipboard.
fn handle_hist_copy(app: &AppHandle, stem: &str) {
    let dir = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        settings::resolved_capture_dir(&s)
    };
    let sidecar = dir.join(format!("{stem}.capnote"));
    match std::fs::read_to_string(&sidecar) {
        Ok(block) => {
            if let Err(e) = app.clipboard().write_text(block) {
                eprintln!("capnote: hist-copy clipboard write failed: {e}");
            }
        }
        Err(e) => eprintln!("capnote: hist-copy read {}: {e}", sidecar.display()),
    }
}

/// Emit capture-done for STEM's PNG so the webview reopens the annotator.
/// No-op (with log) if the PNG no longer exists.
fn handle_hist_reannot(app: &AppHandle, stem: &str) {
    let dir = {
        let ss = app.state::<SettingsState>();
        let s = ss.settings.lock().unwrap();
        settings::resolved_capture_dir(&s)
    };
    let png = dir.join(format!("{stem}.png"));
    if !png.exists() {
        eprintln!("capnote: re-annotate: PNG not found: {}", png.display());
        return;
    }
    let scale = capture::png_scale(&png);
    let _ = app.emit(
        "capture-done",
        CaptureDonePayload {
            path: png.to_string_lossy().to_string(),
            scale,
            reannotate: true,
        },
    );
}

// ── App entry point ─────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance guard registered first per plugin docs.
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            eprintln!("capnote: second instance launched; ignoring");
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            show_capture_window,
            copy_text_and_restore,
            load_capture_png,
            save_annotated_png,
            save_capnote_block,
            discard_capture,
            dismiss_window,
            get_app_status,
            run_test_capture,
            open_screen_recording_settings,
            get_settings,
            save_settings,
        ])
        .setup(|app| {
            // Menubar-resident: no dock icon, no app switcher entry.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Load persisted settings before anything depends on them.
            let loaded = settings::load(app.handle());
            app.manage(SettingsState {
                settings: Mutex::new(loaded.clone()),
            });

            let label = settings::shortcut_label(&loaded);
            let dir = settings::resolved_capture_dir(&loaded);
            let menu = build_tray_menu(app.handle(), &label, &dir)?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id == "capture" {
                        trigger_capture(app);
                    } else if id == "quit" {
                        app.exit(0);
                    } else if id == "settings" {
                        show_window_with_size(app, 460.0, 360.0);
                        let _ = app.emit("open-settings", ());
                    } else if let Some(stem) = id.strip_prefix("hist-copy:") {
                        handle_hist_copy(app, stem);
                    } else if let Some(stem) = id.strip_prefix("hist-reannot:") {
                        handle_hist_reannot(app, stem);
                    }
                })
                .build(app)?;

            // GC old captures off the main thread, after the tray exists so the
            // History submenu can drop any entries the GC removed.
            let gc_handle = app.handle().clone();
            std::thread::spawn(move || {
                let (gc_dir, days, max) = {
                    let ss = gc_handle.state::<SettingsState>();
                    let s = ss.settings.lock().unwrap();
                    (settings::resolved_capture_dir(&s), s.retention_days, s.retention_max)
                };
                capture::gc_capnote_dir(&gc_dir, days, max);
                rebuild_tray_menu(&gc_handle);
            });

            // The handler fires for any registered shortcut (only ours is ever
            // registered), so no per-shortcut comparison is needed here.
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _sc, event| {
                        if event.state() == ShortcutState::Pressed {
                            trigger_capture(app);
                        }
                    })
                    .build(),
            )?;

            // Registration can fail (key taken by another app). The tray menu
            // stays as the capture fallback; the webview shows a banner.
            let shortcut_str = &loaded.shortcut;
            let shortcut = match shortcut_str.parse::<Shortcut>() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("capnote: invalid shortcut '{shortcut_str}': {e}; using default");
                    "alt+shift+c".parse::<Shortcut>().unwrap()
                }
            };
            let registered = app.global_shortcut().register(shortcut).is_ok();
            *app.state::<AppState>().shortcut_registered.lock().unwrap() = registered;
            if !registered {
                eprintln!("warning: failed to register global shortcut {label}");
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
