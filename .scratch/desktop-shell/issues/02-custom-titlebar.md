# Custom titlebar — TopBar as window drag/zoom control

Status: done (landed with this change; pending user eye-verify)

## Problem

The shell showed the native macOS title bar above the app's own 40px TopBar — two stacked bars, one redundant.

## Decision

- `titleBarStyle: "hidden"` + `trafficLightPosition: {x: 16, y: 13}` — native bar gone, traffic lights overlaid and centered in the TopBar. Not `frame: false` (would lose close/minimize entirely).
- Frontend detects the shell via user agent (`Electron`) in `main.tsx` → `desktop-shell` class on `<html>`; browser rendering unchanged.
- `TopBar.css` gated on that class: `-webkit-app-region: drag` on `.topbar`, `padding-left: 84px` clearing the traffic lights, blanket `no-drag` on `button/a/input/select/[role=button]` inside the bar (future controls — e.g. midi lane's planned badge — opt out automatically).
- Double-click-to-zoom is native Electron behavior on drag regions (`AppleActionOnDoubleClick`).
- Retry page body is a drag region (no titlebar there either).

## Acceptance

- No native title bar; traffic lights sit inside the TopBar
- Dragging the TopBar moves the window; mode buttons still click
- Double-click on the TopBar zooms per system preference
- Retry page window is draggable
- In a plain browser, nothing changes
