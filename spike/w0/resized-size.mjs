// Port of the official Anthropic resized_size() reference implementation
// (platform.claude.com/docs/en/build-with-claude/vision-coordinates, fetched 2026-07-03).
//
// Dual constraint (docs/plan-windows.html §6.2):
//   1. Edge limit: neither side, AFTER padding up to the next multiple of 28,
//      exceeds maxEdge (standard tier 1568, high-resolution tier 2576).
//   2. Visual token limit: ceil(w/28) * ceil(h/28) <= maxTokens
//      (standard 1568, high-resolution 4784).
// Claude pads to 28px multiples bottom/right; padding never shifts the origin,
// so coordinates map 1:1 onto the pre-padding resized image.

export const PROFILES = {
  universal: { maxEdge: 1568, maxTokens: 1568 }, // safe on every model tier
  highres: { maxEdge: 2576, maxTokens: 4784 }, // Opus 4.7+ tier (plan §12 decision 4 gate)
};

export function countImageTokens(width, height) {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

// The reference implementation is Python, whose round() is half-to-even
// (banker's rounding). JS Math.round() rounds half up, which drifts the short
// edge by 1px on exact .5 ties (e.g. 1800x1350 universal: 1270x952 vs 1269x952).
// Port faithfully so our saved sizes match what the API computes.
function pythonRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function resizedSize(width, height, { maxEdge, maxTokens } = PROFILES.universal) {
  const fits = (w, h) =>
    Math.ceil(w / 28) * 28 <= maxEdge &&
    Math.ceil(h / 28) * 28 <= maxEdge &&
    countImageTokens(w, h) <= maxTokens;

  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = resizedSize(height, width, { maxEdge, maxTokens });
    return [w, h];
  }

  // Binary search along the long edge for the largest aspect-preserving fit.
  const aspectRatio = width / height;
  let lo = 1; // always fits
  let hi = width; // never fits
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, Math.max(pythonRound(mid / aspectRatio), 1))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [lo, Math.max(pythonRound(lo / aspectRatio), 1)];
}

// CLI: node resized-size.mjs <width> <height> [universal|highres]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [w, h, profile = "universal"] = process.argv.slice(2);
  if (!w || !h) {
    console.error("usage: node resized-size.mjs <width> <height> [universal|highres]");
    process.exit(1);
  }
  const [rw, rh] = resizedSize(Number(w), Number(h), PROFILES[profile]);
  const factor = rw / Number(w);
  console.log(
    `${w}x${h} -> ${rw}x${rh} (factor ${factor.toFixed(3)}, ${countImageTokens(rw, rh)} tokens, profile ${profile})`,
  );
}
