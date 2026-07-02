import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Annotator } from "./annotator";

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

// Phase 2: capture-done payload is now an object (was a plain string path)
interface CaptureDonePayload {
  path: string;
  scale: number;
  // History "Re-annotate" opens a committed PNG — ESC must not delete it.
  reannotate: boolean;
}

const banner = document.querySelector<HTMLDivElement>("#banner")!;
const captureView = document.querySelector<HTMLElement>("#capture-view")!;
const onboardingView = document.querySelector<HTMLElement>("#onboarding-view")!;
const onboardingStatus =
  document.querySelector<HTMLParagraphElement>("#onboarding-status")!;

function showView(view: HTMLElement): void {
  for (const el of [captureView, onboardingView]) {
    el.classList.toggle("hidden", el !== view);
  }
}

async function refreshShortcutBanner(): Promise<void> {
  const status = await invoke<AppStatus>("get_app_status");
  banner.classList.toggle("hidden", status.shortcutRegistered);
  if (!status.shortcutRegistered) {
    banner.textContent =
      `전역 단축키 ${status.shortcutLabel} 등록에 실패했습니다 — ` +
      "다른 앱이 사용 중일 수 있습니다. 메뉴바 아이콘의 Capture 메뉴를 사용하세요.";
  }
}

async function runTestCapture(): Promise<void> {
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
  const canvas = document.querySelector<HTMLCanvasElement>("#annotation-canvas")!;
  const canvasWrap = document.querySelector<HTMLElement>(".canvas-wrap")!;
  const popover = document.querySelector<HTMLElement>("#note-popover")!;
  const popoverTextarea = document.querySelector<HTMLTextAreaElement>("#note-textarea")!;
  const contextInput = document.querySelector<HTMLInputElement>("#context-input")!;
  const toolBtns = document.querySelectorAll<HTMLButtonElement>(".tool-btn");
  const hintError = document.querySelector<HTMLElement>("#hint-error")!;

  const annotator = new Annotator(
    canvas,
    canvasWrap,
    popover,
    popoverTextarea,
    contextInput,
    toolBtns,
    hintError,
  );

  void listen<CaptureDonePayload>("capture-done", (event) => {
    showView(captureView);
    void annotator
      .present(event.payload.path, event.payload.scale, event.payload.reannotate)
      .catch((e) => {
        showView(onboardingView);
        onboardingStatus.textContent = `캡처 로드 실패: ${String(e)}`;
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
    if (captureView.classList.contains("hidden")) {
      // Onboarding view: only handle Escape to dismiss
      if (e.key === "Escape") {
        e.preventDefault();
        void invoke("dismiss_window");
      }
    } else {
      annotator.onKeyDown(e);
    }
  });

  void refreshShortcutBanner();
});
