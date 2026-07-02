import { invoke } from "@tauri-apps/api/core";
import { AnnotationStore, type Annotation, type Tool } from "./annotations";
import { planDownscale, type DownscalePlan } from "./downscale";
import { encodeCapNote } from "./capnote";
import { drawAnnotations, renderBurnIn, hitTest, badgeCenter } from "./burnin";

// "smart" = auto-detect from gesture; Tool values = explicit force
type ActiveTool = "smart" | Tool;

// Extra logical height the window needs beyond the image canvas.
const HINT_BAR_HEIGHT = 40;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 32768;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export class Annotator {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private canvasWrap: HTMLElement;
  private popover: HTMLElement;
  private popoverTextarea: HTMLTextAreaElement;
  private contextInput: HTMLInputElement;
  private toolBtns: NodeListOf<HTMLButtonElement>;
  private hintError: HTMLElement;

  private store = new AnnotationStore();
  private plan: DownscalePlan | null = null;
  private image: HTMLImageElement | null = null;
  private path: string | null = null;

  private cssW = 0;
  private cssH = 0;

  private activeTool: ActiveTool = "smart";
  private selectedIndex = -1;
  private inFlight = false;
  private reannotate = false;

  // drag state
  private dragStartNat: { x: number; y: number } | null = null;
  private dragStartCss: { x: number; y: number } | null = null;
  private dragCurrentNat: { x: number; y: number } | null = null;
  private dragShift = false;
  private dragging = false;

  // index of the annotation being edited in the popover (-1 = closed)
  private popoverIndex = -1;

  constructor(
    canvas: HTMLCanvasElement,
    canvasWrap: HTMLElement,
    popover: HTMLElement,
    popoverTextarea: HTMLTextAreaElement,
    contextInput: HTMLInputElement,
    toolBtns: NodeListOf<HTMLButtonElement>,
    hintError: HTMLElement,
  ) {
    this.canvas = canvas;
    this.canvasWrap = canvasWrap;
    this.popover = popover;
    this.popoverTextarea = popoverTextarea;
    this.contextInput = contextInput;
    this.toolBtns = toolBtns;
    this.hintError = hintError;
    this.ctx = canvas.getContext("2d")!;

    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    canvas.addEventListener("pointercancel", () => this.clearDrag());
  }

  async present(path: string, scale: number, reannotate = false): Promise<void> {
    const t0 = performance.now();
    this.path = path;
    this.reannotate = reannotate;
    this.reset();

    // Load through Rust as a same-origin data: URL — the asset protocol would
    // taint the canvas and make toBlob() throw SecurityError at commit.
    const b64 = await invoke<string>("load_capture_png", { path });
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`이미지 로드 실패: ${path}`));
      image.src = `data:image/png;base64,${b64}`;
    });
    this.image = image;

    const naturalW = image.naturalWidth;
    const naturalH = image.naturalHeight;
    this.plan = planDownscale(naturalW, naturalH, scale);

    // Logical size = natural px / captureScale (NOT window.devicePixelRatio)
    const logicalW = naturalW / scale;
    const logicalH = naturalH / scale;
    const maxW = window.screen.availWidth * 0.92;
    const maxH = window.screen.availHeight * 0.88 - HINT_BAR_HEIGHT;
    const fit = Math.min(1, maxW / logicalW, maxH / logicalH);

    // Canvas keeps the true aspect ratio; only the window has a min width
    // (the wrap centers a narrower canvas).
    this.cssW = Math.round(logicalW * fit);
    this.cssH = Math.round(logicalH * fit);

    await invoke("show_capture_window", {
      width: Math.max(360, this.cssW),
      height: this.cssH + HINT_BAR_HEIGHT,
    });

    this.applyCanvasSize();
    this.redraw();
    // Phase 3 target: capture-done → window shown < 300ms (measure in dev
    // via Safari Web Inspector console; excludes screencapture itself).
    console.info(`present: ${Math.round(performance.now() - t0)}ms (${naturalW}x${naturalH})`);
  }

  private reset(): void {
    this.store.clear();
    this.selectedIndex = -1;
    this.inFlight = false;
    this.clearDrag();
    this.contextInput.value = "";
    this.closePopover();
    this.setTool("smart");
    this.setError("");
  }

  private applyCanvasSize(): void {
    const dpr = window.devicePixelRatio;
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
  }

  private redraw(): void {
    const image = this.image;
    const plan = this.plan;
    if (!image || !plan) return;

    const ctx = this.ctx;
    // s: backing-store px per final-image px — keeps 1 unit = 1 final-image px
    const s = this.canvas.width / plan.finalW;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, plan.finalW, plan.finalH);
    ctx.drawImage(image, 0, 0, plan.finalW, plan.finalH);

    // Append live preview annotation while dragging
    let anns: readonly Annotation[] = this.store.all;
    if (this.dragging && this.dragStartNat && this.dragCurrentNat) {
      const cur = this.dragCurrentNat;
      const start = this.dragStartNat;
      const preview: Annotation = {
        kind: this.getDragKind(),
        x1: start.x, y1: start.y,
        x2: cur.x, y2: cur.y,
        note: "",
      };
      anns = [...this.store.all, preview];
    }

    drawAnnotations(ctx, anns, plan);

    // Selection ring: #2563eb 2px ring radius 14 final-px around badge centre
    if (this.selectedIndex >= 0 && this.selectedIndex < this.store.count) {
      const bc = badgeCenter(this.store.all, this.selectedIndex, plan);
      ctx.save();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(bc.x, bc.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private toNatural(offsetX: number, offsetY: number): { x: number; y: number } {
    const image = this.image;
    if (!image || !this.cssW || !this.cssH) return { x: 0, y: 0 };
    return {
      x: (offsetX / this.cssW) * image.naturalWidth,
      y: (offsetY / this.cssH) * image.naturalHeight,
    };
  }

  private getDragKind(): "rect" | "arrow" {
    if (this.activeTool === "arrow") return "arrow";
    if (this.activeTool === "rect") return "rect";
    // smart or point: Shift key switches to arrow
    return this.dragShift ? "arrow" : "rect";
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.plan) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const nat = this.toNatural(e.offsetX, e.offsetY);
    this.dragStartNat = nat;
    this.dragStartCss = { x: e.offsetX, y: e.offsetY };
    this.dragCurrentNat = { ...nat };
    this.dragShift = e.shiftKey;
    this.dragging = false;
  }

  private onPointerMove(e: PointerEvent): void {
    const startCss = this.dragStartCss;
    if (!startCss) return;
    this.dragCurrentNat = this.toNatural(e.offsetX, e.offsetY);
    const dx = e.offsetX - startCss.x;
    const dy = e.offsetY - startCss.y;
    if (Math.hypot(dx, dy) >= 4) this.dragging = true;
    if (this.dragging) this.redraw();
  }

  private onPointerUp(e: PointerEvent): void {
    const startNat = this.dragStartNat;
    const plan = this.plan;
    if (!startNat || !plan) {
      this.clearDrag();
      return;
    }
    this.canvas.releasePointerCapture(e.pointerId);

    if (this.dragging) {
      const cur = this.dragCurrentNat ?? startNat;
      const a: Annotation = {
        kind: this.getDragKind(),
        x1: startNat.x, y1: startNat.y,
        x2: cur.x, y2: cur.y,
        note: "",
      };
      const index = this.store.add(a);
      this.selectedIndex = index;
      this.openPopover(index);
    } else {
      // Click: hit-test first
      const hit = hitTest(this.store.all, plan, startNat.x, startNat.y);
      if (hit !== -1) {
        this.selectedIndex = hit;
      } else if (this.activeTool !== "rect" && this.activeTool !== "arrow") {
        // Smart or explicit point mode: place a point marker
        const a: Annotation = {
          kind: "point",
          x1: startNat.x, y1: startNat.y,
          x2: startNat.x, y2: startNat.y,
          note: "",
        };
        const index = this.store.add(a);
        this.selectedIndex = index;
        this.openPopover(index);
      }
      // Explicit rect/arrow with no drag and no hit: no-op
    }

    this.clearDrag();
    this.redraw();
  }

  private clearDrag(): void {
    this.dragStartNat = null;
    this.dragStartCss = null;
    this.dragCurrentNat = null;
    this.dragging = false;
  }

  private openPopover(index: number): void {
    const plan = this.plan;
    if (!plan) return;
    const bc = badgeCenter(this.store.all, index, plan);

    // badgeCenter is in final-image px; convert to CSS px within canvas-wrap
    const canvasOffsetX = (this.canvasWrap.clientWidth - this.cssW) / 2;
    const canvasOffsetY = (this.canvasWrap.clientHeight - this.cssH) / 2;
    const rawLeft = canvasOffsetX + (bc.x / plan.finalW) * this.cssW + 12;
    const rawTop = canvasOffsetY + (bc.y / plan.finalH) * this.cssH + 12;

    const POPOVER_W = 280;
    const POPOVER_H = 90;
    const maxLeft = this.canvasWrap.clientWidth - POPOVER_W - 8;
    const maxTop = this.canvasWrap.clientHeight - POPOVER_H - 8;
    this.popover.style.left = `${Math.max(8, Math.min(rawLeft, maxLeft))}px`;
    this.popover.style.top = `${Math.max(8, Math.min(rawTop, maxTop))}px`;

    this.popoverIndex = index;
    this.popoverTextarea.value = this.store.all[index]?.note ?? "";
    this.popover.classList.remove("hidden");
    this.popoverTextarea.focus();
  }

  private confirmPopover(): void {
    if (this.popoverIndex < 0) return;
    const note = this.popoverTextarea.value;
    // Empty input clears the note (also how an existing note is removed).
    this.store.setNote(this.popoverIndex, note.trim() ? note : "");
    this.closePopover();
    this.canvas.focus();
    this.redraw();
  }

  private closePopover(): void {
    this.popover.classList.add("hidden");
    this.popoverIndex = -1;
  }

  private setTool(tool: ActiveTool): void {
    this.activeTool = tool;
    this.toolBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset["tool"] === tool);
    });
  }

  private setError(msg: string): void {
    this.hintError.textContent = msg;
    this.hintError.classList.toggle("hidden", !msg);
  }

  async commit(): Promise<void> {
    if (this.inFlight) return;
    const path = this.path;
    const plan = this.plan;
    const image = this.image;
    if (!path || !plan || !image) return;

    this.inFlight = true;
    this.setError("");

    try {
      const burned = renderBurnIn(image, this.store.all, plan);

      const dataBase64 = await new Promise<string>((resolve, reject) => {
        burned.toBlob((blob) => {
          if (!blob) {
            reject(new Error("toBlob returned null"));
            return;
          }
          void blob
            .arrayBuffer()
            .then((ab) => resolve(arrayBufferToBase64(ab)))
            .catch(reject);
        }, "image/png");
      });

      await invoke("save_annotated_png", { path, dataBase64 });

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const timestamp =
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
        ` ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const context = this.contextInput.value.trim();
      const text = encodeCapNote(this.store.all, plan, {
        imagePath: path,
        timestamp,
        context,
      });

      // Sidecar powers the tray History submenu (copy again / re-annotate).
      await invoke("save_capnote_block", { path, block: text });
      await invoke("copy_text_and_restore", { text });
      this.reset();
    } catch (err) {
      this.setError(`저장 오류: ${String(err)}`);
    } finally {
      this.inFlight = false;
    }
  }

  async cancel(): Promise<void> {
    const path = this.path;
    if (!path) return;
    // "Cancel saves nothing" applies to fresh captures only — a re-annotation
    // opened from History must leave the committed PNG in place (past CapNote
    // blocks reference it).
    if (!this.reannotate) {
      await invoke("discard_capture", { path });
    }
    await invoke("dismiss_window");
    this.reset();
  }

  onKeyDown(e: KeyboardEvent): void {
    const inPopover = document.activeElement === this.popoverTextarea;
    const inContext = document.activeElement === this.contextInput;

    if (inPopover) {
      if (e.key === "Enter" && e.metaKey) {
        // One-shot loop (plan §6): confirm the note being typed, then commit.
        e.preventDefault();
        this.confirmPopover();
        void this.commit();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.confirmPopover();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closePopover();
        this.canvas.focus();
      }
      return;
    }

    if (inContext) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.contextInput.blur();
      }
      return;
    }

    // Global shortcuts — only active when focus is not in any text field
    if (e.key === "Escape") {
      e.preventDefault();
      void this.cancel();
    } else if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      void this.commit();
    } else if (e.key === "c" && e.metaKey) {
      e.preventDefault();
      void this.commit();
    } else if (e.key === "z" && e.metaKey) {
      e.preventDefault();
      this.store.undo();
      if (this.selectedIndex >= this.store.count) this.selectedIndex = -1;
      this.redraw();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      if (this.selectedIndex >= 0) {
        e.preventDefault();
        this.store.remove(this.selectedIndex);
        this.selectedIndex = -1;
        this.redraw();
      }
    } else if (e.key === "Enter") {
      if (this.selectedIndex >= 0) {
        e.preventDefault();
        this.openPopover(this.selectedIndex);
      }
    } else if (e.key === "1") {
      this.setTool(this.activeTool === "point" ? "smart" : "point");
    } else if (e.key === "2") {
      this.setTool(this.activeTool === "rect" ? "smart" : "rect");
    } else if (e.key === "3" || e.key === "a") {
      this.setTool(this.activeTool === "arrow" ? "smart" : "arrow");
    }
  }
}
