//! Frontmost-app remember/restore via AppKit (no TCC prompt involved).

use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

pub fn frontmost_app_pid() -> Option<i32> {
    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    Some(app.processIdentifier())
}

pub fn activate_pid(pid: i32) -> bool {
    match NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        // Cooperative activation: we are frontmost when this runs (the user just
        // pressed ⌘⏎/Esc in our window), so macOS 14+ grants the switch without
        // the deprecated ignoringOtherApps flag.
        Some(app) => app.activateWithOptions(NSApplicationActivationOptions::empty()),
        None => false,
    }
}
