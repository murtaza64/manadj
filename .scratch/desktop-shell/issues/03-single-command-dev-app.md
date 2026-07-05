# Single command for servers + shell; live-reload story

Status: done (landed with this change; pending user eye-verify)

## Problem

Starting the full desktop experience took two terminals (`make dev`, `make app`). Also: does Electron live-reload?

## Decision

- `make dev-app` → `scripts/dev.py --app`: dev.py spawns the shell as a third peer child (label `app`, magenta). Orchestration lives in dev.py; the shell itself stays attach-only (issue 01) — its retry page absorbs the electron-before-Vite race.
- dev.py's existing invariant (any child exits → tear down all) is kept deliberately: **Cmd+Q on the window shuts down the servers** — one command, one app. Use `make dev` + `make app` for independent lifecycles.
- Live reload: nothing added. Frontend HMR and `uvicorn --reload` already apply inside the window (it renders the Vite dev server). `desktop/main.js` changes require relaunching the shell — rare; deliberately no electronmon dependency.

## Acceptance

- `make dev-app` brings up backend, Vite, and the window; logs multiplex with an `app` label
- Cmd+Q (or closing the window) stops backend and Vite; Ctrl-C stops all three
- `make dev` / `make app` unchanged
