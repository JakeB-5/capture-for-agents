// Verifies the resized_size() port against (a) the official docs' A4 example and
// (b) the scenario table in docs/plan-windows.html §6.3.
// Run: node spike/w0/resized-size.test.mjs
import { resizedSize, countImageTokens, PROFILES } from "./resized-size.mjs";

const cases = [
  // [label, w, h, profile, expectedW, expectedH]
  ["docs A4 example", 1075, 1520, "universal", 924, 1307],
  ["FHD @100% full screen", 1920, 1080, "universal", 1456, 819],
  ["QHD @125% full screen", 2560, 1440, "universal", 1456, 819],
  ["Surface 3:2 @150% full screen", 2880, 1920, "universal", 1344, 896],
  ["4K @150% full screen", 3840, 2160, "universal", 1456, 819],
  ["800x600 CSS region @125%", 1000, 750, "universal", 1000, 750],
  ["1200x900 CSS window @150%", 1800, 1350, "universal", 1270, 952],
  ["FHD @100% full screen", 1920, 1080, "highres", 1920, 1080],
  ["QHD @125% full screen", 2560, 1440, "highres", 2560, 1440],
  ["Surface 3:2 @150% full screen", 2880, 1920, "highres", 2352, 1568],
  ["4K @150% full screen", 3840, 2160, "highres", 2576, 1449],
  ["1200x900 CSS window @150%", 1800, 1350, "highres", 1800, 1350],
];

let failed = 0;
for (const [label, w, h, profile, ew, eh] of cases) {
  const [rw, rh] = resizedSize(w, h, PROFILES[profile]);
  const ok = rw === ew && rh === eh;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label} [${profile}] ${w}x${h} -> ${rw}x${rh}` +
      (ok ? "" : ` (expected ${ew}x${eh})`) +
      `  tokens=${countImageTokens(rw, rh)}`,
  );
}

// Invariant: every result must itself fit both constraints, and never upscale.
for (const [label, w, h, profile] of cases) {
  const p = PROFILES[profile];
  const [rw, rh] = resizedSize(w, h, p);
  const padOk = Math.ceil(rw / 28) * 28 <= p.maxEdge && Math.ceil(rh / 28) * 28 <= p.maxEdge;
  const tokOk = countImageTokens(rw, rh) <= p.maxTokens;
  const noUpscale = rw <= w && rh <= h;
  if (!(padOk && tokOk && noUpscale)) {
    failed++;
    console.log(`FAIL  invariant violated: ${label} [${profile}] -> ${rw}x${rh}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log("\nAll checks passed.");
