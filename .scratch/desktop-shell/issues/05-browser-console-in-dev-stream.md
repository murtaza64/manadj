# Renderer console in the dev-app stream

Status: done (landed with this change)

## Problem

`make dev-app` multiplexed backend/frontend/shell logs, but the renderer's `console.*` (the actual frontend) only surfaced in DevTools — Chromium doesn't put it on stdout.

## Decision

- `desktop/main.js` forwards `webContents` `console-message` events to stdout as `[browser] <level>: <message> (<source>:<line>)` — level tag and source location only for warnings/errors; multi-line messages split. Handles both the Electron 32+ event shape and the legacy positional signature.
- `scripts/dev.py` relabels `[app]`-sourced lines carrying the `[browser] ` prefix into their own cyan `[browser]` label. Bare `make app` terminals get the prefixed lines as-is, still readable.
- `ELECTRON_DISABLE_SECURITY_WARNINGS` set in the shell: the Vite dev target has no CSP, so the renderer-console security warning is permanent noise once console is forwarded.

## Acceptance

- `make dev-app`: frontend `console.log/warn/error` appear under `[browser]`; warnings/errors carry source:line
- No repeated Electron security-warning spam
- DevTools unaffected
