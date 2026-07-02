use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

const SCREENCAPTURE: &str = "/usr/sbin/screencapture";

pub enum CaptureOutcome {
    /// Saved to the configured capture dir; scale is 2 on Retina, 1 otherwise.
    Captured { path: PathBuf, scale: u32 },
    /// User pressed ESC — screencapture exits without creating the file.
    Cancelled,
}

#[derive(Debug)]
pub enum CaptureError {
    /// TCC Screen Recording not granted: exit 1 + "could not create image".
    TccDenied(String),
    Failed(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::TccDenied(msg) => write!(f, "screen recording permission denied: {msg}"),
            CaptureError::Failed(msg) => write!(f, "screencapture failed: {msg}"),
        }
    }
}

/// Destination path with a collision-safe timestamp name.
fn dest_path(dir: &Path) -> PathBuf {
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S").to_string();
    let base = dir.join(format!("{stamp}.png"));
    if !base.exists() {
        return base;
    }
    for n in 1.. {
        let candidate = dir.join(format!("{stamp}-{n}.png"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

fn run_screencapture(args: &[&str], out_file: &Path) -> Result<std::process::Output, CaptureError> {
    Command::new(SCREENCAPTURE)
        .args(args)
        .arg(out_file)
        .output()
        .map_err(|e| CaptureError::Failed(format!("cannot spawn {SCREENCAPTURE}: {e}")))
}

fn classify_failure(stderr: &str) -> CaptureError {
    if stderr.contains("could not create image") {
        CaptureError::TccDenied(stderr.trim().to_string())
    } else {
        CaptureError::Failed(stderr.trim().to_string())
    }
}

/// Capture pixel density from the PNG pHYs chunk: 144dpi => @2x, else @1x.
/// Best-effort — any read/parse failure means 1.
pub fn png_scale(path: &Path) -> u32 {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return 1,
    };
    let decoder = png::Decoder::new(std::io::BufReader::new(file));
    let reader = match decoder.read_info() {
        Ok(r) => r,
        Err(_) => return 1,
    };
    if let Some(dims) = reader.info().pixel_dims {
        if dims.unit == png::Unit::Meter {
            let dpi = dims.xppu as f64 * 0.0254;
            if dpi.round() >= 140.0 {
                return 2;
            }
        }
    }
    1
}

/// True iff `path` is a .png directly inside `configured_dir` (no traversal).
/// `configured_dir` is expected to already be canonicalized or expandable.
pub fn is_capnote_png(configured_dir: &Path, path: &Path) -> bool {
    if path.extension().and_then(|e| e.to_str()) != Some("png") {
        return false;
    }
    let actual_parent = match path.parent() {
        Some(p) => p,
        None => return false,
    };
    // Canonicalize the parent only — the file itself may not exist yet.
    let canon_actual = match actual_parent.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let canon_expected = configured_dir
        .canonicalize()
        .unwrap_or_else(|_| configured_dir.to_path_buf());
    canon_actual == canon_expected
}

/// Best-effort GC of `dir`: remove *.png older than `days` days, then keep
/// only the newest `max`. Deletes paired .capnote sidecars with each PNG and
/// removes orphan .capnote files whose PNG no longer exists.
/// Never errors — logs to stderr at most.
pub fn gc_capnote_dir(dir: &Path, days: u32, max: usize) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(u64::from(days) * 24 * 3600))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut survivors: Vec<(SystemTime, PathBuf)> = Vec::new();
    // Track stems that survive age GC (used for orphan sidecar cleanup below).
    let mut surviving_stems: HashSet<String> = HashSet::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }
        let mtime = match entry.metadata().and_then(|m| m.modified()) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if mtime < cutoff {
            // Delete PNG and its paired sidecar.
            delete_with_sidecar(&path);
        } else {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                surviving_stems.insert(stem.to_owned());
            }
            survivors.push((mtime, path));
        }
    }

    // Remove oldest excess beyond `max`, including their sidecars.
    if survivors.len() > max {
        survivors.sort_unstable_by_key(|(t, _)| *t);
        for (_, path) in &survivors[..survivors.len() - max] {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                surviving_stems.remove(stem);
            }
            delete_with_sidecar(path);
        }
    }

    // Remove orphan .capnote files whose PNG was already deleted (by prior GC
    // runs or manual deletion) so sidecars never accumulate indefinitely.
    let orphan_scan = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in orphan_scan.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("capnote") {
            continue;
        }
        let stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_owned(),
            None => continue,
        };
        if !surviving_stems.contains(&stem) {
            if let Err(e) = fs::remove_file(&path) {
                eprintln!("capnote gc: {}: {e}", path.display());
            }
        }
    }
}

/// Delete a PNG and its paired .capnote sidecar (if present). Best-effort.
fn delete_with_sidecar(png: &Path) {
    if let Err(e) = fs::remove_file(png) {
        eprintln!("capnote gc: {}: {e}", png.display());
    }
    let sidecar = png.with_extension("capnote");
    if sidecar.exists() {
        if let Err(e) = fs::remove_file(&sidecar) {
            eprintln!("capnote gc: {}: {e}", sidecar.display());
        }
    }
}

/// Interactive capture: drag selection, Space toggles window mode, ESC cancels.
/// Saves to `dest_dir` (created if absent).
pub fn run_interactive_capture(dest_dir: &Path) -> Result<CaptureOutcome, CaptureError> {
    let tmp = std::env::temp_dir().join(format!("capnote-{}.png", std::process::id()));
    let _ = fs::remove_file(&tmp);

    let output = run_screencapture(&["-i", "-x", "-o", "-t", "png"], &tmp)?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !tmp.exists() {
        // ESC leaves no file and no error message; TCC denial leaves an error.
        if !output.status.success() && !stderr.trim().is_empty() {
            return Err(classify_failure(&stderr));
        }
        return Ok(CaptureOutcome::Cancelled);
    }

    // Ensure the configured directory exists before moving the temp file.
    fs::create_dir_all(dest_dir)
        .map_err(|e| CaptureError::Failed(format!("cannot create {}: {e}", dest_dir.display())))?;

    let dest = dest_path(dest_dir);
    if fs::rename(&tmp, &dest).is_err() {
        // tmp and $HOME may be on different volumes.
        fs::copy(&tmp, &dest)
            .map_err(|e| CaptureError::Failed(format!("cannot save to {}: {e}", dest.display())))?;
        let _ = fs::remove_file(&tmp);
    }
    let scale = png_scale(&dest);
    Ok(CaptureOutcome::Captured { path: dest, scale })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaptureReport {
    pub ok: bool,
    pub width: u32,
    pub height: u32,
    pub message: String,
}

/// Non-interactive test capture used by TCC onboarding. Verifies actual pixels:
/// an unapproved state can silently return a screen with windows missing, so we
/// require a decodable PNG whose pixels are not uniform.
pub fn run_test_capture() -> Result<TestCaptureReport, CaptureError> {
    let tmp = std::env::temp_dir().join(format!("capnote-test-{}.png", std::process::id()));
    let _ = fs::remove_file(&tmp);

    let output = run_screencapture(&["-x", "-t", "png", "-R", "0,0,240,240"], &tmp)?;
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !tmp.exists() {
        return Err(classify_failure(if stderr.trim().is_empty() {
            "no image was produced"
        } else {
            &stderr
        }));
    }

    let report = verify_pixels(&tmp);
    let _ = fs::remove_file(&tmp);
    report
}

fn verify_pixels(path: &Path) -> Result<TestCaptureReport, CaptureError> {
    let file = fs::File::open(path)
        .map_err(|e| CaptureError::Failed(format!("cannot open test capture: {e}")))?;
    let decoder = png::Decoder::new(std::io::BufReader::new(file));
    let mut reader = decoder
        .read_info()
        .map_err(|e| CaptureError::Failed(format!("test capture is not a valid PNG: {e}")))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader
        .next_frame(&mut buf)
        .map_err(|e| CaptureError::Failed(format!("cannot decode test capture: {e}")))?;

    let bytes = &buf[..info.buffer_size()];
    let bpp = (info.color_type.samples() * ((info.bit_depth as usize + 7) / 8)).max(1);
    let uniform = bytes.chunks(bpp).all(|px| px == &bytes[..px.len()]);

    Ok(TestCaptureReport {
        ok: !uniform,
        width: info.width,
        height: info.height,
        message: if uniform {
            "캡처가 생성됐지만 픽셀이 균일합니다 — 화면 기록 권한을 확인하세요".into()
        } else {
            "화면 기록 권한이 정상입니다".into()
        },
    })
}
