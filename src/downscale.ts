// Downscale policy (invariants 2-3): the saved image's own pixels are the one
// and only coordinate space. Long edge ≤ 1568px so the Anthropic vision API
// never resizes; Retina @2x halves; already-small crops stay native (keeps 1px
// detail); never upscale.

export const MAX_LONG_EDGE = 1568;

export interface DownscalePlan {
  finalW: number;
  finalH: number;
  /** natural px → final saved px multiplier (≤ 1; 1 = native). */
  factor: number;
  /** Physical px per point at capture time, from the PNG pHYs chunk (1 or 2). */
  captureScale: number;
  /** image px : CSS px ratio in the saved file (factor × captureScale). */
  imagePxPerCssPx: number;
}

export function planDownscale(
  naturalW: number,
  naturalH: number,
  captureScale: number,
): DownscalePlan {
  const long = Math.max(naturalW, naturalH);
  let factor = 1;
  if (long > MAX_LONG_EDGE) {
    factor = captureScale >= 2 ? 0.5 : MAX_LONG_EDGE / long;
    // A halved @2x capture from a very large display can still exceed the cap.
    if (long * factor > MAX_LONG_EDGE) factor = MAX_LONG_EDGE / long;
  }
  const finalW = Math.max(1, Math.round(naturalW * factor));
  const finalH = Math.max(1, Math.round(naturalH * factor));
  const exactFactor = finalW / naturalW;
  return {
    finalW,
    finalH,
    factor: exactFactor,
    captureScale,
    imagePxPerCssPx: exactFactor * captureScale,
  };
}

/** Map a natural-px coordinate into the saved image's pixel space. */
export function toFinalPx(v: number, plan: DownscalePlan, max: number): number {
  return Math.min(Math.max(0, Math.round(v * plan.factor)), max - 1);
}
