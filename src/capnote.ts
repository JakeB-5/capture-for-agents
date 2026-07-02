// CapNote v1 encoder. Grammar is FROZEN — single source: docs/plan.html §4.
// Any change to syntax here is a v1.1 proposal, not an edit.

import type { Annotation } from "./annotations";
import { normalizedRect } from "./annotations";
import type { DownscalePlan } from "./downscale";
import { toFinalPx } from "./downscale";

// hint v2, frozen by Phase 0 amendment A3 (docs/phase0-verification.md).
const HINT =
  "hint: Read the image file at the path above. Numbered badges matching " +
  "[n] are burned into the image. Coordinates are image pixels (origin " +
  "top-left); px values in notes are CSS px.";

export interface CapNoteMeta {
  /** Absolute path of the burned-in PNG the agent will Read. */
  imagePath: string;
  /** Local time of the commit, e.g. "2026-07-02 16:48". */
  timestamp: string;
  /** Optional one-line summary; empty string omits the context line. */
  context: string;
}

function scaleLine(plan: DownscalePlan): string {
  const r = plan.imagePxPerCssPx;
  const n = Number.isInteger(r) ? String(r) : String(Math.round(r * 100) / 100);
  return `scale: ${n} image px = 1 CSS px`;
}

function sourceLine(plan: DownscalePlan, timestamp: string): string {
  const how =
    plan.factor === 1
      ? "native"
      : plan.factor === 0.5
        ? "downscaled 1/2"
        : `downscaled to ${plan.finalW}x${plan.finalH}`;
  return `source: screen capture @${plan.captureScale}x, ${how} (${timestamp})`;
}

function entryLine(n: number, a: Annotation, plan: DownscalePlan): string {
  const px = (v: number) => toFinalPx(v, plan, plan.finalW);
  const py = (v: number) => toFinalPx(v, plan, plan.finalH);
  switch (a.kind) {
    case "point":
      return `[${n}] point (${px(a.x1)},${py(a.y1)})`;
    case "rect": {
      const r = normalizedRect(a);
      return `[${n}] rect (${px(r.x1)},${py(r.y1)})-(${px(r.x2)},${py(r.y2)})`;
    }
    case "arrow":
      return `[${n}] arrow (${px(a.x1)},${py(a.y1)})->(${px(a.x2)},${py(a.y2)})`;
  }
}

export function encodeCapNote(
  annotations: readonly Annotation[],
  plan: DownscalePlan,
  meta: CapNoteMeta,
): string {
  const lines: string[] = [
    "```capnote v1",
    `image: ${meta.imagePath}`,
    `size: ${plan.finalW}x${plan.finalH}`,
    scaleLine(plan),
    sourceLine(plan, meta.timestamp),
  ];
  const context = meta.context.trim();
  if (context) lines.push(`context: ${context}`);

  annotations.forEach((a, i) => {
    lines.push(entryLine(i + 1, a, plan));
    const note = a.note.replace(/\s+$/, "");
    if (note) {
      for (const noteLine of note.split("\n")) {
        lines.push(`    ${noteLine}`);
      }
    }
  });

  lines.push(HINT, "```");
  return lines.join("\n") + "\n";
}
