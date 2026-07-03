# Contributing to Yeogiyo!! (여기요!!)

Thanks for your interest! This is a small, opinionated tool with a **frozen wire format** at its core. Most contribution friction comes from not knowing which parts are frozen and which are open — this document makes that explicit.

## Ground rules (read this first)

### The five design invariants are non-negotiable

Defined in [README.md](README.md#core-design-invariants). In short: text-only clipboard, one coordinate space (the saved image's pixels), long edge ≤ 1568px PNG, burn-in at final resolution, one shared number sequence. PRs that violate an invariant will be declined regardless of implementation quality — they are the product.

### CapNote v1 grammar is frozen

The single source of truth for the grammar, burn-in styles, and coordinate policy is `docs/plan.html` §4–5 (Korean). It was frozen after a blind-agent E2E validation (9/9 marker identification — see `docs/phase0-verification.md`).

- **Do not change the grammar, the `hint:` wording, or the burn-in styles in a PR.**
- Propose grammar changes as a **v1.1 proposal issue** instead, with evidence (e.g., an agent-interpretation failure case). The v1.1 backlog lives in `docs/phase0-verification.md` §5.

### Changes to the format/burn-in/coordinate pipeline require a real E2E test

If your PR touches `src/capnote.ts`, `src/burnin.ts`, `src/downscale.ts`, or anything affecting saved-image coordinates: paste an actual generated CapNote block into a real Claude Code session and confirm the agent identifies all three marker kinds (point/rect/arrow) correctly. Unit-style checks alone do not qualify. Include the result in your PR description.

## Development setup

macOS only (the capture path shells out to `/usr/sbin/screencapture`).

```sh
pnpm install
pnpm tauri dev     # vite dev server + Rust build
```

Notes:

- **TCC**: in dev mode, the Screen Recording permission attaches to your *terminal/IDE*, not the app. Grant it to whatever launches `pnpm tauri dev`.
- **Single instance**: don't run `tauri dev` twice — port 1420 conflicts, and macOS allows only one interactive screencapture at a time.
- Captured files live in `~/.capnote/` (configurable via the tray → Settings…).

## Before you open a PR

All three must pass, with zero errors:

```sh
pnpm check                    # tsc --noEmit
pnpm lint                     # eslint --quiet src
cargo check                   # in src-tauri/
```

Plus the E2E rule above when applicable.

## Workflow

- Branch from `dev`: `git checkout -b feature/<name> dev`
- Open PRs **targeting `dev`** (not `main`).
- Commit messages in English. UI strings are Korean; code comments are English and sparse — explain constraints, not mechanics.
- Tauri plugin versions are **pinned exactly** (`=x.y.z`) in `src-tauri/Cargo.toml`. Plugin upgrades must be deliberate, in their own PR, with a rationale.

## Repository map

| Path | What it is |
| --- | --- |
| `src/annotations.ts` | annotation model; the positional number sequence (join key) |
| `src/downscale.ts` | ≤1568px downscale policy (invariants 2–3) |
| `src/capnote.ts` | CapNote v1 encoder — **frozen grammar** |
| `src/burnin.ts` | burn-in renderer + hit-testing — **frozen styles**; shared by preview and commit |
| `src/annotator.ts`, `src/main.ts` | canvas editor and app wiring |
| `src-tauri/src/` | thin Rust shell: capture spawn, clipboard, tray/history, settings, GC |
| `docs/plan.html` | work plan & design rationale (single source for the spec, Korean) |
| `docs/phase*-verification.md` | per-phase verification reports (Korean) |
| `HANDOFF.md` | session handoff / current state (Korean) |

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
