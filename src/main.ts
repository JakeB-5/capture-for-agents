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

interface Settings {
  shortcut: string;
  captureDir: string;
  retentionDays: number;
  retentionMax: number;
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
const settingsView = document.querySelector<HTMLElement>("#settings-view")!;

function showView(view: HTMLElement): void {
  for (const el of [captureView, onboardingView, settingsView]) {
    el.classList.toggle("hidden", el !== view);
  }
}

async function refreshShortcutBanner(status?: AppStatus): Promise<void> {
  const s = status ?? (await invoke<AppStatus>("get_app_status"));
  banner.classList.toggle("hidden", s.shortcutRegistered);
  if (!s.shortcutRegistered) {
    banner.textContent =
      `전역 단축키 ${s.shortcutLabel} 등록에 실패했습니다 — ` +
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

// Convert a raw shortcut string like "alt+shift+c" to a macOS pretty label "⌥⇧C".
function shortcutLabel(raw: string): string {
  const parts = raw.split("+");
  if (parts.length === 0) return raw;
  const key = parts.pop()!;
  let out = "";
  for (const mod of parts) {
    switch (mod.toLowerCase()) {
      case "cmd":
      case "command":
      case "super":
      case "meta":
        out += "⌘";
        break;
      case "ctrl":
      case "control":
        out += "⌃";
        break;
      case "alt":
      case "option":
        out += "⌥";
        break;
      case "shift":
        out += "⇧";
        break;
      default:
        out += mod;
    }
  }
  out += key.toUpperCase();
  return out;
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

  // ── Settings view elements ──────────────────────────────────────────────

  const shortcutInput = document.querySelector<HTMLInputElement>("#shortcut-input")!;
  const captureDirInput = document.querySelector<HTMLInputElement>("#capture-dir-input")!;
  const retentionDaysInput = document.querySelector<HTMLInputElement>("#retention-days-input")!;
  const retentionMaxInput = document.querySelector<HTMLInputElement>("#retention-max-input")!;
  const settingsStatus = document.querySelector<HTMLSpanElement>("#settings-status")!;
  const settingsSave = document.querySelector<HTMLButtonElement>("#settings-save")!;
  const settingsCancel = document.querySelector<HTMLButtonElement>("#settings-cancel")!;

  // Tracks the raw plugin-format shortcut string ("alt+shift+c") for submission.
  let pendingShortcut = "";

  // Focus the shortcut input: show a prompt to start capturing a key combo.
  shortcutInput.addEventListener("focus", () => {
    shortcutInput.value = "단축키를 입력하세요…";
    shortcutInput.classList.add("capturing");
  });

  shortcutInput.addEventListener("blur", () => {
    shortcutInput.classList.remove("capturing");
    // If no new shortcut was captured, revert to the stored pending value.
    shortcutInput.value = shortcutLabel(pendingShortcut);
  });

  shortcutInput.addEventListener("keydown", (e) => {
    e.preventDefault();
    // Stop propagation so the global Esc handler doesn't close the window.
    e.stopPropagation();

    if (e.key === "Escape") {
      // Just blur — don't alter pendingShortcut.
      shortcutInput.blur();
      return;
    }

    const modifiers: string[] = [];
    if (e.metaKey) modifiers.push("cmd");
    if (e.ctrlKey) modifiers.push("ctrl");
    if (e.altKey) modifiers.push("alt");
    if (e.shiftKey) modifiers.push("shift");

    // Ignore bare modifier keypresses.
    const modifierCodes = new Set([
      "MetaLeft", "MetaRight",
      "ControlLeft", "ControlRight",
      "AltLeft", "AltRight",
      "ShiftLeft", "ShiftRight",
    ]);
    if (modifierCodes.has(e.code) || modifiers.length === 0) return;

    // Convert KeyboardEvent.code to global_hotkey format.
    let pluginKey: string;
    if (e.code.startsWith("Key")) {
      pluginKey = e.code.slice(3).toLowerCase(); // "KeyC" → "c"
    } else if (e.code.startsWith("Digit")) {
      pluginKey = e.code.slice(5); // "Digit1" → "1"
    } else if (/^F\d+$/.test(e.code)) {
      pluginKey = e.code.toLowerCase(); // "F1" → "f1"
    } else {
      return; // unsupported key type
    }

    pendingShortcut = [...modifiers, pluginKey].join("+");
    shortcutInput.value = shortcutLabel(pendingShortcut);
    shortcutInput.blur();
  });

  // Save button.
  settingsSave.addEventListener("click", async () => {
    settingsStatus.textContent = "";
    if (!pendingShortcut) {
      settingsStatus.textContent = "단축키를 입력해 주세요.";
      return;
    }
    const payload: Settings = {
      shortcut: pendingShortcut,
      captureDir: captureDirInput.value.trim() || "~/.capnote",
      retentionDays: Math.max(1, parseInt(retentionDaysInput.value, 10) || 14),
      retentionMax: Math.max(10, parseInt(retentionMaxInput.value, 10) || 500),
    };
    try {
      const status = await invoke<AppStatus>("save_settings", { settings: payload });
      settingsStatus.textContent = "저장됨";
      // Update the shortcut failure banner with the new registration state.
      void refreshShortcutBanner(status);
      setTimeout(() => void invoke("dismiss_window"), 600);
    } catch (e) {
      settingsStatus.textContent = String(e);
    }
  });

  // Cancel button: close without saving.
  settingsCancel.addEventListener("click", () => void invoke("dismiss_window"));

  // ── Tauri event listeners ───────────────────────────────────────────────

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

  void listen("open-settings", async () => {
    settingsStatus.textContent = "";
    try {
      const s = await invoke<Settings>("get_settings");
      pendingShortcut = s.shortcut;
      shortcutInput.value = shortcutLabel(s.shortcut);
      captureDirInput.value = s.captureDir;
      retentionDaysInput.value = String(s.retentionDays);
      retentionMaxInput.value = String(s.retentionMax);
    } catch (e) {
      settingsStatus.textContent = `설정 로드 실패: ${String(e)}`;
    }
    showView(settingsView);
  });

  document
    .querySelector<HTMLButtonElement>("#open-settings")!
    .addEventListener("click", () => void invoke("open_screen_recording_settings"));
  document
    .querySelector<HTMLButtonElement>("#test-capture")!
    .addEventListener("click", () => void runTestCapture());

  window.addEventListener("keydown", (e) => {
    if (!settingsView.classList.contains("hidden")) {
      // Settings view: Esc closes (shortcut input handles its own Esc via stopPropagation).
      if (e.key === "Escape") {
        e.preventDefault();
        void invoke("dismiss_window");
      }
    } else if (!captureView.classList.contains("hidden")) {
      // Capture view: delegate all keys to the annotator.
      annotator.onKeyDown(e);
    } else {
      // Onboarding view: Esc closes.
      if (e.key === "Escape") {
        e.preventDefault();
        void invoke("dismiss_window");
      }
    }
  });

  void refreshShortcutBanner();
});
