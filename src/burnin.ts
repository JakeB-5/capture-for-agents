// Burn-in renderer — single source of shape geometry for both live preview
// overlay and final committed PNG. Invariant 4: render at final resolution.

import type { Annotation } from "./annotations.ts";
import { normalizedRect } from "./annotations.ts";
import type { DownscalePlan } from "./downscale.ts";

// ── Style constants (frozen spec: docs/plan.html §5 + Phase 0 amendment A4) ──

const ACCENT = "#d97706";
const HALO = "rgba(255,255,255,0.9)";
const BADGE_R = 11;          // badge circle radius
const POINT_R = 8;           // point ring radius
const STROKE = 2;            // base stroke width for shapes
const LEADER_W = 1.5;        // leader line stroke width
const BADGE_DIST = 22;       // badge center distance from anchor (final px)
const BADGE_FONT = `bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const RECT_OUTSET = 2;       // annotation rect drawn 2px outside user rect
const ARROW_HEAD_LEN = 10;   // arrowhead length
const ARROW_HEAD_HALF = 4.5; // arrowhead half-width
const LEADER_STOP = 3;       // stop leader 3px short of anchor to avoid occlusion
const HIT_TOL = 6;           // hit-test tolerance (final px)
const BADGE_MARGIN = 2;      // min clearance between badge edge and image edge

// Collision-avoidance thresholds.
const BADGE_SEP_MIN = 2 * BADGE_R + 2;   // min center-to-center between badges (24 px)
const ANCHOR_CLEAR_MIN = BADGE_R + 6;    // min badge-center-to-anchor distance (17 px)
const BADGE_RING2_EXTRA = 14;            // additional offset for second candidate ring

// Candidate directions: 4 diagonals (up-left first, frozen order) then 4 cardinals.
const BADGE_DIRS8: ReadonlyArray<readonly [number, number]> = [
  [-1 / Math.SQRT2, -1 / Math.SQRT2], // up-left  (diagonal, preferred)
  [1 / Math.SQRT2, -1 / Math.SQRT2],  // up-right
  [-1 / Math.SQRT2, 1 / Math.SQRT2],  // down-left
  [1 / Math.SQRT2, 1 / Math.SQRT2],   // down-right
  [0, -1],                             // up     (cardinal)
  [1, 0],                              // right
  [0, 1],                              // down
  [-1, 0],                             // left
];

// ── Internal geometry helpers ─────────────────────────────────────────────────

function squaredDist(x1: number, y1: number, x2: number, y2: number): number {
  return (x1 - x2) ** 2 + (y1 - y2) ** 2;
}

function pointSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(squaredDist(px, py, ax, ay));
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.sqrt(squaredDist(px, py, ax + t * dx, ay + t * dy));
}

/** Anchor point in final-image px that the leader line targets. */
function anchorFinal(a: Annotation, plan: DownscalePlan): { ax: number; ay: number } {
  const f = plan.factor;
  if (a.kind === "rect") {
    // Top-left corner of the outset rect (not the raw user corner).
    const r = normalizedRect(a);
    return { ax: r.x1 * f - RECT_OUTSET, ay: r.y1 * f - RECT_OUTSET };
  }
  // point → the point; arrow → the tail.
  return { ax: a.x1 * f, ay: a.y1 * f };
}

/** Sequential deterministic badge placement with collision avoidance.
 * Returns one {x,y} center per annotation in final-image px, same index order.
 * Each badge is placed considering all previously placed badges (indices < i),
 * so order matters: index 0 is unconstrained, later badges adapt.
 * O(n²) on ≤20 annotations — no caching needed. */
function computeBadgePlacements(
  annotations: readonly Annotation[],
  plan: DownscalePlan,
): { x: number; y: number }[] {
  const W = plan.finalW;
  const H = plan.finalH;
  const placed: { x: number; y: number }[] = [];
  const anchors = annotations.map((a) => anchorFinal(a, plan));

  for (let i = 0; i < annotations.length; i++) {
    const { ax, ay } = anchors[i]!;

    // 16 candidates: ring 1 at BADGE_DIST, ring 2 at BADGE_DIST + BADGE_RING2_EXTRA.
    const candidates: { x: number; y: number }[] = [];
    for (const dist of [BADGE_DIST, BADGE_DIST + BADGE_RING2_EXTRA]) {
      for (const [dx, dy] of BADGE_DIRS8) {
        candidates.push({ x: ax + dx * dist, y: ay + dy * dist });
      }
    }

    // Rule 1: badge circle fully within image (always required, never relaxed).
    const inBounds = (cx: number, cy: number): boolean =>
      cx - BADGE_R >= BADGE_MARGIN &&
      cy - BADGE_R >= BADGE_MARGIN &&
      cx + BADGE_R <= W - BADGE_MARGIN &&
      cy + BADGE_R <= H - BADGE_MARGIN;

    // Rule 2: no overlap with already-placed badges — center-to-center ≥ BADGE_SEP_MIN.
    const clearOfBadges = (cx: number, cy: number): boolean =>
      placed.every((p) => squaredDist(cx, cy, p.x, p.y) >= BADGE_SEP_MIN * BADGE_SEP_MIN);

    // Rule 3: does not cover another annotation's anchor point (every j ≠ i).
    const clearOfAnchors = (cx: number, cy: number): boolean =>
      anchors.every(
        (anc, j) =>
          j === i ||
          squaredDist(cx, cy, anc.ax, anc.ay) >= ANCHOR_CLEAR_MIN * ANCHOR_CLEAR_MIN,
      );

    // Progressive relaxation: all rules → drop rule 3 → drop rule 2 → clamp.
    let result =
      candidates.find((c) => inBounds(c.x, c.y) && clearOfBadges(c.x, c.y) && clearOfAnchors(c.x, c.y)) ??
      candidates.find((c) => inBounds(c.x, c.y) && clearOfBadges(c.x, c.y)) ??   // relax rule 3
      candidates.find((c) => inBounds(c.x, c.y));                                 // relax rule 2

    if (!result) {
      // Final fallback: clamp up-left candidate into image bounds.
      const fcx = ax - BADGE_DIST / Math.SQRT2;
      const fcy = ay - BADGE_DIST / Math.SQRT2;
      result = {
        x: Math.max(BADGE_R + BADGE_MARGIN, Math.min(W - BADGE_R - BADGE_MARGIN, fcx)),
        y: Math.max(BADGE_R + BADGE_MARGIN, Math.min(H - BADGE_R - BADGE_MARGIN, fcy)),
      };
    }

    placed.push(result);
  }

  return placed;
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────

/** Stroke current path twice: HALO (width+2.5) then ACCENT (width). */
function strokeHaloAccent(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.lineWidth = width + 2.5;
  ctx.strokeStyle = HALO;
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = ACCENT;
  ctx.stroke();
}

/** Fill+stroke current path twice: HALO then ACCENT (for filled arrowhead). */
function fillStrokeHaloAccent(ctx: CanvasRenderingContext2D, width: number): void {
  ctx.fillStyle = HALO;
  ctx.lineWidth = width + 2.5;
  ctx.strokeStyle = HALO;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = width;
  ctx.strokeStyle = ACCENT;
  ctx.fill();
  ctx.stroke();
}

// ── Per-kind shape drawing ────────────────────────────────────────────────────

function drawPoint(ctx: CanvasRenderingContext2D, a: Annotation, plan: DownscalePlan): void {
  ctx.setLineDash([]);
  ctx.beginPath();
  // Ring (non-filled) so the target pixel beneath is never covered.
  ctx.arc(a.x1 * plan.factor, a.y1 * plan.factor, POINT_R, 0, Math.PI * 2);
  strokeHaloAccent(ctx, STROKE);
}

function drawRect(ctx: CanvasRenderingContext2D, a: Annotation, plan: DownscalePlan): void {
  const r = normalizedRect(a);
  const f = plan.factor;
  const x = r.x1 * f - RECT_OUTSET;
  const y = r.y1 * f - RECT_OUTSET;
  const w = (r.x2 - r.x1) * f + RECT_OUTSET * 2;
  const h = (r.y2 - r.y1) * f + RECT_OUTSET * 2;
  // Dashed + outset so vision agents don't mistake it for a real UI border.
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  strokeHaloAccent(ctx, STROKE);
  ctx.setLineDash([]);
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Annotation, plan: DownscalePlan): void {
  const f = plan.factor;
  const x1 = a.x1 * f;
  const y1 = a.y1 * f;
  const x2 = a.x2 * f;
  const y2 = a.y2 * f;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return; // degenerate

  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular unit vector for arrowhead wings.
  const px = -uy;
  const py = ux;

  // Shaft ends at arrowhead base so cap doesn't overdraw the head.
  const hbx = x2 - ux * ARROW_HEAD_LEN;
  const hby = y2 - uy * ARROW_HEAD_LEN;

  ctx.setLineDash([]);

  // Shaft
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(hbx, hby);
  strokeHaloAccent(ctx, STROKE);

  // Filled arrowhead triangle
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(hbx + px * ARROW_HEAD_HALF, hby + py * ARROW_HEAD_HALF);
  ctx.lineTo(hbx - px * ARROW_HEAD_HALF, hby - py * ARROW_HEAD_HALF);
  ctx.closePath();
  fillStrokeHaloAccent(ctx, STROKE);
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  index: number,
  placement: { x: number; y: number },
  plan: DownscalePlan,
): void {
  const { x: cx, y: cy } = placement;
  const { ax, ay } = anchorFinal(a, plan);

  // Leader line from badge edge toward anchor, stopping short to avoid covering target.
  const ldx = ax - cx;
  const ldy = ay - cy;
  const ldist = Math.sqrt(ldx * ldx + ldy * ldy);
  if (ldist > BADGE_R + LEADER_STOP) {
    const lux = ldx / ldist;
    const luy = ldy / ldist;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx + lux * BADGE_R, cy + luy * BADGE_R);
    ctx.lineTo(ax - lux * LEADER_STOP, ay - luy * LEADER_STOP);
    strokeHaloAccent(ctx, LEADER_W);
  }

  // Badge circle: accent fill with 1.5px white outline.
  ctx.beginPath();
  ctx.arc(cx, cy, BADGE_R, 0, Math.PI * 2);
  ctx.fillStyle = ACCENT;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "white";
  ctx.stroke();

  // 1-based number label centered in the badge.
  ctx.font = BADGE_FONT;
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index + 1), cx, cy + 0.5);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Draw all annotation shapes and their numbered badges. The ctx must already
 * be transformed so 1 unit = 1 final-image pixel; annotation coords are
 * natural px and get multiplied by plan.factor. Stroke widths, badge radius,
 * fonts are absolute final-image px (invariant 4: render at final resolution). */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly Annotation[],
  plan: DownscalePlan,
): void {
  // Compute all badge positions once — preview, burn-in, and hit-test share this.
  const placements = computeBadgePlacements(annotations, plan);

  // All shapes first so badges always render on top regardless of draw order.
  for (const a of annotations) {
    if (a.kind === "point") drawPoint(ctx, a, plan);
    else if (a.kind === "rect") drawRect(ctx, a, plan);
    else drawArrow(ctx, a, plan);
  }
  for (let i = 0; i < annotations.length; i++) {
    drawBadge(ctx, annotations[i]!, i, placements[i]!, plan);
  }
}

/** Full burn-in: downscale the source image per plan (high-quality smoothing)
 * and draw annotations at final resolution. Returns a finalW×finalH canvas. */
export function renderBurnIn(
  image: HTMLImageElement,
  annotations: readonly Annotation[],
  plan: DownscalePlan,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = plan.finalW;
  canvas.height = plan.finalH;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, plan.finalW, plan.finalH);
  drawAnnotations(ctx, annotations, plan);
  return canvas;
}

/** Hit test for selection. (x,y) in natural px. Returns the topmost matching
 * annotation index (last drawn wins) or -1. A hit is: inside the badge circle,
 * on a shape stroke within tolerance, or (rect) on the outset rect edges. */
export function hitTest(
  annotations: readonly Annotation[],
  plan: DownscalePlan,
  x: number,
  y: number,
): number {
  const fx = x * plan.factor;
  const fy = y * plan.factor;

  // Placements computed once per call — O(n²) on ≤20 annotations is negligible
  // for a pointer-event handler; badge positions must stay in sync with draw.
  const placements = computeBadgePlacements(annotations, plan);

  // Iterate last to first so the topmost-drawn annotation wins.
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]!;

    // Badge hit (takes priority over shape hit).
    const { x: bx, y: by } = placements[i]!;
    if (squaredDist(fx, fy, bx, by) <= BADGE_R * BADGE_R) return i;

    // Shape hit.
    const f = plan.factor;
    if (a.kind === "point") {
      // Hit the ring stroke, not the interior.
      const d = Math.sqrt(squaredDist(fx, fy, a.x1 * f, a.y1 * f));
      if (Math.abs(d - POINT_R) <= HIT_TOL) return i;
    } else if (a.kind === "rect") {
      const r = normalizedRect(a);
      const rx = r.x1 * f - RECT_OUTSET;
      const ry = r.y1 * f - RECT_OUTSET;
      const rr = r.x2 * f + RECT_OUTSET;
      const rb = r.y2 * f + RECT_OUTSET;
      // Edges only — interior click must fall through to create new annotation.
      if (
        pointSegmentDist(fx, fy, rx, ry, rr, ry) <= HIT_TOL ||
        pointSegmentDist(fx, fy, rr, ry, rr, rb) <= HIT_TOL ||
        pointSegmentDist(fx, fy, rx, rb, rr, rb) <= HIT_TOL ||
        pointSegmentDist(fx, fy, rx, ry, rx, rb) <= HIT_TOL
      ) return i;
    } else {
      // Arrow: point-to-segment distance along the full tail→head line.
      if (
        pointSegmentDist(fx, fy, a.x1 * f, a.y1 * f, a.x2 * f, a.y2 * f) <= HIT_TOL
      ) return i;
    }
  }
  return -1;
}

/** Badge center in final-image px for annotation at `index` (annotator uses it
 * to anchor the note popover and selection ring). */
export function badgeCenter(
  annotations: readonly Annotation[],
  index: number,
  plan: DownscalePlan,
): { x: number; y: number } {
  if (!annotations[index]) return { x: 0, y: 0 };
  return computeBadgePlacements(annotations, plan)[index] ?? { x: 0, y: 0 };
}
