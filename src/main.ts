import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TestCaptureReport {
  ok: boolean;
  width: number;
  height: number;
  message: string;
}

interface AppStatus {
  shortcutRegistered: boolean;
  shortcutLabel: string;
}

const banner = document.querySelector<HTMLDivElement>("#banner")!;
const captureView = document.querySelector<HTMLElement>("#capture-view")!;
const onboardingView = document.querySelector<HTMLElement>("#onboarding-view")!;
const captureImg = document.querySelector<HTMLImageElement>("#capture-img")!;
const capturePath = document.querySelector<HTMLSpanElement>("#capture-path")!;
const onboardingStatus =
  document.querySelector<HTMLParagraphElement>("#onboarding-status")!;

let currentPath: string | null = null;

function showView(view: HTMLElement) {
  for (const el of [captureView, onboardingView]) {
    el.classList.toggle("hidden", el !== view);
  }
}

// Extra logical height the window needs beyond the image itself.
const HINT_BAR_HEIGHT = 34;

async function presentCapture(path: string) {
  currentPath = path;
  capturePath.textContent = path;
  showView(captureView);

  await new Promise<void>((resolve, reject) => {
    captureImg.onload = () => resolve();
    captureImg.onerror = () => reject(new Error(`failed to load ${path}`));
    captureImg.src = convertFileSrc(path);
  });

  // The saved PNG carries physical pixels; divide by the device pixel ratio so
  // a Retina capture is presented at its on-screen logical size.
  const logicalW = captureImg.naturalWidth / window.devicePixelRatio;
  const logicalH = captureImg.naturalHeight / window.devicePixelRatio;
  const maxW = window.screen.availWidth * 0.92;
  const maxH = window.screen.availHeight * 0.88 - HINT_BAR_HEIGHT;
  const fit = Math.min(1, maxW / logicalW, maxH / logicalH);

  await invoke("show_capture_window", {
    width: Math.max(360, Math.round(logicalW * fit)),
    height: Math.round(logicalH * fit) + HINT_BAR_HEIGHT,
  });
}

async function copyAndReturn() {
  if (!currentPath) return;
  await invoke("copy_path_and_restore", { path: currentPath });
}

async function refreshShortcutBanner() {
  const status = await invoke<AppStatus>("get_app_status");
  banner.classList.toggle("hidden", status.shortcutRegistered);
  if (!status.shortcutRegistered) {
    banner.textContent =
      `전역 단축키 ${status.shortcutLabel} 등록에 실패했습니다 — ` +
      "다른 앱이 사용 중일 수 있습니다. 메뉴바 아이콘의 Capture 메뉴를 사용하세요.";
  }
}

async function runTestCapture() {
  onboardingStatus.textContent = "테스트 캡처 실행 중…";
  try {
    const report = await invoke<TestCaptureReport>("run_test_capture");
    onboardingStatus.textContent = report.ok
      ? `✅ ${report.message} (${report.width}×${report.height})`
      : `❌ ${report.message}`;
  } catch (e) {
    onboardingStatus.textContent = `❌ ${String(e)}`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  void listen<string>("capture-done", (event) => {
    void presentCapture(event.payload).catch((e) => {
      capturePath.textContent = String(e);
    });
  });

  void listen<string>("capture-tcc-denied", () => {
    showView(onboardingView);
    onboardingStatus.textContent = "";
  });

  void listen<string>("capture-error", (event) => {
    showView(onboardingView);
    onboardingStatus.textContent = `캡처 실패: ${event.payload}`;
  });

  document
    .querySelector<HTMLButtonElement>("#open-settings")!
    .addEventListener("click", () => void invoke("open_screen_recording_settings"));
  document
    .querySelector<HTMLButtonElement>("#test-capture")!
    .addEventListener("click", () => void runTestCapture());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void invoke("dismiss_window");
    } else if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      void copyAndReturn();
    }
  });

  void refreshShortcutBanner();
});
