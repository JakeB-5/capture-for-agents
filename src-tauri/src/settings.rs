use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub shortcut: String,
    pub capture_dir: String,
    pub retention_days: u32,
    pub retention_max: usize,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "alt+shift+c".into(),
            capture_dir: "~/.capnote".into(),
            retention_days: 14,
            retention_max: 500,
        }
    }
}

/// Read `<app_config_dir>/settings.json`; any error falls back to Default (logged to stderr).
pub fn load(app: &AppHandle) -> Settings {
    let path = match config_path(app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("capnote settings: cannot resolve config dir: {e}");
            return Settings::default();
        }
    };
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            eprintln!("capnote settings: parse error ({e}), using defaults");
            Settings::default()
        }),
        Err(_) => Settings::default(),
    }
}

/// Write pretty JSON to `<app_config_dir>/settings.json`, creating dirs as needed.
pub fn save(app: &AppHandle, s: &Settings) -> Result<(), String> {
    let path = config_path(app).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Expand a leading `~` to $HOME. Returns the path as-is if HOME is unset.
pub fn resolved_capture_dir(s: &Settings) -> PathBuf {
    let raw = &s.capture_dir;
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(rest);
        }
    } else if raw == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home);
        }
    }
    PathBuf::from(raw)
}

/// Convert a shortcut string like "alt+shift+c" to a macOS pretty label "⌥⇧C".
/// Modifiers must precede the key (same rule as the plugin parser).
/// Best-effort: unrecognised tokens pass through unchanged.
pub fn shortcut_label(s: &Settings) -> String {
    let mut parts: Vec<&str> = s.shortcut.split('+').collect();
    if parts.is_empty() {
        return s.shortcut.clone();
    }
    let key = parts.pop().unwrap_or("");
    let mut out = String::new();
    for modifier in &parts {
        out.push_str(match modifier.to_lowercase().as_str() {
            "cmd" | "command" | "super" | "meta" => "⌘",
            "ctrl" | "control" => "⌃",
            "alt" | "option" => "⌥",
            "shift" => "⇧",
            other => other,
        });
    }
    out.push_str(&key.to_uppercase());
    out
}
