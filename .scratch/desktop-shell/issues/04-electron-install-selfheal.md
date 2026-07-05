# Self-heal broken electron installs

Status: done (landed with this change)

## Problem

Every fresh workspace hits the broken electron postinstall (npm allow-scripts blocks it; on Node 26 `install.js` cache-hits then exits without extracting), leaving `node_modules/electron` without `path.txt` / with a partial `dist/`. Hit twice for real: the desktopshell lane and the default workspace.

## Decision

`desktop/ensure-electron.sh` — idempotent repair, run by `make app` and `make dev-app` before launch: healthy → instant no-op; else extract the cached zip (`ditto`), running `install.js` first if the cache is empty (it downloads even when its extraction no-ops), and write `path.txt`. macOS arm64 only, matching the shell's dev-machine scope. README troubleshooting now points at it.

## Acceptance

- `make app` / `make dev-app` work in a workspace where `npm install` left electron broken
- No-op overhead when healthy is a stat check
