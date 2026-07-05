# Electron attach-only desktop shell

Status: done (landed yrquxwmr; pending user eye-verify of `make app`)

## Problem

manadj runs as two dev processes (`make dev`: uvicorn :8000 + Vite :5173) viewed in a browser tab. No dock icon, no app identity, MIDI permission prompts, and Chromium background throttling can stall UI clocks while Decks play.

## Decision (grilled 2026-07-04)

Build a **Desktop shell** (see CONTEXT.md): an Electron window that attaches to an already-running manadj. Not a distributable — no Python/ffmpeg/frontend bundling, ever, in this ticket.

- **Attach-only.** The shell never spawns uvicorn or Vite; `make dev` stays the way processes are run and logs are watched. If the URL doesn't load, show an inline "backend not running — retry" page that polls ~2s and auto-loads when Vite responds.
- **Port/URL argument** (default `http://localhost:5173`) so parallel-work lanes on offset ports can use it.
- **Layout**: top-level `desktop/` with its own minimal `package.json` (electron as the only dep). Add a `make app` target with `PORT=` passthrough.
- **Window behavior**:
  - `backgroundThrottling: false` — a DJ app must never have rAF/timers throttled while occluded
  - Auto-grant Web MIDI incl. sysex (`setPermissionRequestHandler` + `setPermissionCheckHandler`)
  - Cmd+W quits (single window; no hidden-but-playing state)
  - Persist window bounds across launches (small JSON in `desktop/`)
  - Stock Electron menu; no tray, no media keys

## Why Electron (record in desktop/README.md)

- Tauri disqualified: WKWebView has **no Web MIDI**, which the Controller (`frontend/src/midi/adapter.ts`) requires. Do not "lighten" to Tauri.
- Chrome `--app=` mode can't own dock identity, MIDI permission grants, or throttling flags.
- No ADR: choice is cheaply reversible, so it fails the ADR three-part test — README note suffices.

## Acceptance

- `make app` opens the window against a running `make dev`; audio, MIDI controller, and WebGL2 waveforms work as in the browser
- `make app PORT=5273` attaches to a lane
- Launching with nothing running shows the retry page, then auto-loads once `make dev` comes up
- Window size/position survives relaunch

## Comments

**Done** (desktopshell lane, landed on main as `yrquxwmr`, 2026-07-04): `desktop/` (main.js, package.json, README with why-not-Tauri + install troubleshooting) and `make app PORT=`. Gate green twice (rebased after perf-layout 02 landed mid-verify): 530 pytest / 349 vitest / build / one alembic head. Smoke-tested: retry page when target down, auto-attach when the server comes up, window bounds persist. Pending user eye-verify: `make app` against a running dev server (audio + MIDI controller + WebGL2 waveforms).

**Note to midi-controller lane**: this file and the CONTEXT.md "Desktop shell" entry were accidentally snapshotted into your change `xrunwzzz` (authored in the default workspace pre-lane). They now land on trunk via this docs change. The CONTEXT.md hunk is byte-identical (merges cleanly); this file differs (Done comment) — on rebase, resolve the add/add by taking trunk's version, or `jj restore` these two paths out of `xrunwzzz` beforehand.
