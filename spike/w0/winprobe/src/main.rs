// winprobe — throwaway Phase W0 spike (docs/plan-windows.html §12 items 4–5).
// Run on the Windows verification machine; compiles on macOS so the API usage
// is checked before the device exists. Not product code — no error polish.
//
//   winprobe monitors          list monitors: position/size (physical px) + scale factor
//   winprobe capture           capture every monitor to PNG + uniform-pixel check
//   winprobe hotkey            Alt+Shift+C global-hotkey callback smoke test
//   winprobe overlay [--cold]  hotkey → overlay window visibility latency (<300ms target)

use std::time::{Duration, Instant};

use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use tao::dpi::{PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopWindowTarget};
use tao::window::{Window, WindowBuilder};

const OVERLAY_HTML: &str = r#"<!DOCTYPE html><html><body style="margin:0;background:#111827;color:#f9fafb;display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui"><div style="text-align:center"><h1 style="font-weight:600">W0 overlay probe</h1><p>Alt+Shift+C 다시 누르면 숨김 · 터미널 Ctrl+C로 종료</p></div></body></html>"#;

fn main() {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    match cmd.as_str() {
        "monitors" => monitors(),
        "capture" => capture(),
        "hotkey" => hotkey_smoke(),
        "overlay" => overlay(std::env::args().any(|a| a == "--cold")),
        _ => {
            eprintln!("usage: winprobe <monitors|capture|hotkey|overlay [--cold]>");
            std::process::exit(1);
        }
    }
}

// ── monitors: physical geometry + scale factor per monitor ──────────────────

fn monitors() {
    let monitors = xcap::Monitor::all().expect("Monitor::all() failed");
    println!("{} monitor(s). Sizes below are PHYSICAL pixels as reported by xcap.", monitors.len());
    for (i, m) in monitors.iter().enumerate() {
        println!(
            "[{}] name={:?} pos=({},{}) size={}x{} scale_factor={:?} primary={:?}",
            i,
            m.name().unwrap_or_else(|_| "<err>".into()),
            m.x().unwrap_or_default(),
            m.y().unwrap_or_default(),
            m.width().unwrap_or_default(),
            m.height().unwrap_or_default(),
            m.scale_factor(),
            m.is_primary(),
        );
    }
    println!("\nPASS criteria (125%/150% monitor): size = native panel resolution (not CSS px),");
    println!("scale_factor matches the OS display scale exactly.");
}

// ── capture: PNG per monitor + privacy-toggle detection ─────────────────────

fn capture() {
    let monitors = xcap::Monitor::all().expect("Monitor::all() failed");
    for (i, m) in monitors.iter().enumerate() {
        let t = Instant::now();
        let img = match m.capture_image() {
            Ok(img) => img,
            Err(e) => {
                println!("[{i}] capture FAILED: {e} (Win11 privacy toggle Off? — §5 안내 문구 대상)");
                continue;
            }
        };
        let ms = t.elapsed().as_millis();
        let (w, h) = (img.width(), img.height());

        // Uniform-frame check: a blocked/blank capture comes back as one flat color.
        let mut min = [u8::MAX; 3];
        let mut max = [0u8; 3];
        for p in img.pixels() {
            for c in 0..3 {
                min[c] = min[c].min(p.0[c]);
                max[c] = max[c].max(p.0[c]);
            }
        }
        let uniform = min == max;

        let path = format!("winprobe-capture-{i}.png");
        img.save(&path).expect("png save failed");
        println!("[{i}] saved {path} {w}x{h} in {ms}ms{}", if uniform {
            "  ⚠ UNIFORM FRAME — capture may be blocked (Win11 privacy toggle) or monitor asleep"
        } else {
            ""
        });
    }
    println!("\nPASS criteria: saved WxH equals the monitor's physical resolution from `winprobe monitors`.");
}

// ── shared hotkey plumbing ───────────────────────────────────────────────────

fn register_hotkey(manager: &GlobalHotKeyManager) -> u32 {
    // Same combination the product uses: Alt+Shift+C (⌥⇧C on macOS).
    let hk = HotKey::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyC);
    manager.register(hk).expect("hotkey register failed");
    hk.id()
}

// ── hotkey: callback smoke test ──────────────────────────────────────────────

fn hotkey_smoke() {
    let event_loop = EventLoop::new();
    // Must be created on the thread that runs the event loop (Windows message loop).
    let manager = GlobalHotKeyManager::new().expect("GlobalHotKeyManager::new failed");
    let id = register_hotkey(&manager);
    let started = Instant::now();
    let mut count = 0u32;

    println!("registered Alt+Shift+C (id={id}). Press it — each fire prints a line. Ctrl+C to quit.");
    event_loop.run(move |_event, _target, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(50));
        // Keep the manager alive inside the closure (drop would unregister).
        let _ = &manager;
        while let Ok(ev) = GlobalHotKeyEvent::receiver().try_recv() {
            if ev.state == HotKeyState::Pressed {
                count += 1;
                println!("fire #{count} at t+{:.1}s (id={})", started.elapsed().as_secs_f32(), ev.id);
            }
        }
    });
}

// ── overlay: hotkey → visible latency ────────────────────────────────────────

struct Overlay {
    window: Window,
    // Kept alive for the window's lifetime; never read after creation.
    _webview: wry::WebView,
}

fn build_overlay(target: &EventLoopWindowTarget<()>, visible: bool) -> Overlay {
    let monitor = target.primary_monitor().expect("no primary monitor");
    let size: PhysicalSize<u32> = monitor.size();
    let pos: PhysicalPosition<i32> = monitor.position();

    #[allow(unused_mut)]
    let mut builder = WindowBuilder::new()
        .with_title("winprobe overlay")
        .with_decorations(false)
        .with_always_on_top(true)
        .with_visible(visible)
        .with_position(pos)
        .with_inner_size(size);
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowBuilderExtWindows;
        builder = builder.with_skip_taskbar(true);
    }
    let window = builder.build(target).expect("window build failed");

    let webview = wry::WebViewBuilder::new()
        .with_html(OVERLAY_HTML)
        .build(&window)
        .expect("webview build failed");

    Overlay { window, _webview: webview }
}

fn overlay(cold: bool) {
    let event_loop = EventLoop::new();
    let manager = GlobalHotKeyManager::new().expect("GlobalHotKeyManager::new failed");
    register_hotkey(&manager);

    // Pre-created strategy (§5 설계 노트): build hidden at startup, show on hotkey.
    // Cold strategy (--cold): build the window+webview at hotkey time.
    let mut overlay: Option<Overlay> = if cold {
        None
    } else {
        let t = Instant::now();
        let o = build_overlay(&event_loop, false);
        println!("pre-created hidden overlay in {}ms (startup cost, not per-capture)", t.elapsed().as_millis());
        Some(o)
    };
    let mut shown = false;
    let mut pending: Option<Instant> = None;

    println!(
        "mode: {}. Alt+Shift+C toggles the overlay; latency prints on Focused/Redraw. Ctrl+C to quit.",
        if cold { "cold (create at hotkey time)" } else { "pre-created (hidden at startup)" }
    );

    event_loop.run(move |event, target, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(10));
        let _ = &manager; // keep hotkey registration alive

        while let Ok(ev) = GlobalHotKeyEvent::receiver().try_recv() {
            if ev.state != HotKeyState::Pressed {
                continue;
            }
            if shown {
                if cold {
                    overlay = None; // drop closes the window
                } else if let Some(o) = &overlay {
                    o.window.set_visible(false);
                }
                shown = false;
                println!("overlay hidden");
            } else {
                let t = Instant::now();
                if cold {
                    overlay = Some(build_overlay(target, true));
                }
                if let Some(o) = &overlay {
                    o.window.set_visible(true);
                    o.window.set_focus();
                }
                pending = Some(t);
                shown = true;
            }
        }

        // Two visibility proxies: Focused(true) and the first redraw after show.
        // Neither is exactly first-paint, but they bracket it well enough for
        // the <300ms 판정 (spike-grade measurement).
        match event {
            Event::WindowEvent { event: WindowEvent::Focused(true), .. } => {
                if let Some(t) = pending {
                    println!("  hotkey → Focused(true): {}ms", t.elapsed().as_millis());
                }
            }
            Event::RedrawRequested(_) => {
                if let Some(t) = pending.take() {
                    println!("  hotkey → RedrawRequested: {}ms", t.elapsed().as_millis());
                }
            }
            _ => {}
        }
    });
}
