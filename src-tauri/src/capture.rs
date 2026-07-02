use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const SCREENCAPTURE: &str = "/usr/sbin/screencapture";

pub enum CaptureOutcome {
    /// Saved to ~/.capnote/YYYY-MM-DD-HHMMSS.png
    Captured(PathBuf),
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

fn capnote_dir() -> Result<PathBuf, CaptureError> {
    let home = std::env::var("HOME")
        .map_err(|_| CaptureError::Failed("HOME is not set".into()))?;
    let dir = Path::new(&home).join(".capnote");
    fs::create_dir_all(&dir)
        .map_err(|e| CaptureError::Failed(format!("cannot create {}: {e}", dir.display())))?;
    Ok(dir)
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

/// Interactive capture: drag selection, Space toggles window mode, ESC cancels.
pub fn run_interactive_capture() -> Result<CaptureOutcome, CaptureError> {
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

    let dest = dest_path(&capnote_dir()?);
    if fs::rename(&tmp, &dest).is_err() {
        // tmp and $HOME may be on different volumes.
        fs::copy(&tmp, &dest)
            .map_err(|e| CaptureError::Failed(format!("cannot save to {}: {e}", dest.display())))?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(CaptureOutcome::Captured(dest))
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
