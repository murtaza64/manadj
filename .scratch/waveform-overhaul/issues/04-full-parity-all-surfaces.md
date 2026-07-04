# 04 — full parity: all surfaces on the new renderer, old renderer deleted

Status: ready-for-agent

## Parent

`.scratch/waveform-overhaul/PRD.md`

## What to build

Every waveform surface — Performance decks, minimaps, Transition editor timeline — renders via the new module, and the old geometry renderer is deleted. Port the old renderer's overlay passes as-is (they are vertex-geometry passes independent of the body rendering): beatgrid with density culling, Main cue marker, Hot Cue markers with slot colors, playhead, and the 2D canvas overlay (hot-cue badges, time/bar readout). Implement the structural surface modes as uniforms/config on the new renderer: minimap mode (full track, bottom-anchored, moving playhead), external display-window mode (editor), amplitude anchor top/bottom (editor's stacked halves), linked visible-seconds zoom (`setVisibleSeconds`). Lift `MAX_ZOOM_FACTOR` — the guard existed only for full-track geometry memory. Delete the old renderer and the JSON waveform fetch path; repoint anything left.

Carried-over known limitation (per PRD): only the first tempo change of variable Beatgrids is honored, same as today.

## Acceptance criteria

- [ ] Performance view (both decks + minimaps), library player, and Transition editor all render via the new module
- [ ] Beatgrid, Main cue, Hot Cues, playhead, and badge/time overlays behave identically to the old renderer
- [ ] Editor: display-window mode, amplitude-anchored stacked halves, and drag/zoom parity
- [ ] Linked zoom in Performance view works; zoom floor/ceiling behavior sensible without MAX_ZOOM_FACTOR
- [ ] Old geometry renderer and JSON fetch hook are deleted; no consumer of the JSON endpoint remains in the frontend
- [ ] `npx vitest run` and `npm run build` green in `frontend/`

## Blocked by

- `03-library-player-renders-v2.md`
