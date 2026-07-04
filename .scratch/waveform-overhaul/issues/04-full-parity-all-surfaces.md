# 04 — full parity: all surfaces on the new renderer, old renderer deleted

Status: resolved (wfproto lane, 2026-07-04 — pending user eye-verify of performance view + editor)

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

## Comments

**2026-07-04 (wfproto lane, change `zuyusmko`)** — Implemented. `WaveformRendererV2` grew
full parity: overlay pass ported from the legacy renderer (beatgrid with density culling +
time-anchored vertex cache translated by a uniform, Main cue triangle+line, Hot Cue lines +
edge-anchored triangles + badge/time 2D overlay canvas, playhead incl. minimap-moving and
external-window modes); amplitude anchors (center/top/bottom, minimap forced bottom);
waveformBrightness (markers full-strength); modulation via a per-frame-sampled 1024-texel
RGBA texture (editor EQ/fader lanes, values encoded /2 for boosts up to 2x); external
display windows; unified click-to-seek across modes. Surfaces swapped: `WebGLWaveform`
(legacy path + renderEngine prop removed), `WaveformMinimap`, `DawTimeline` (driven mode,
both rows), `GlobalMinimap` (now consumes `toThreeBands()` derived from the 8-band blob).
Deleted: `utils/WebGLWaveformRenderer.ts` (1503 lines), `hooks/useWaveformRenderer.ts`,
`hooks/useWaveformData.ts`; `waveformZoom.ts` lost `MAX_ZOOM_FACTOR` +
`zoomFactorForVisibleSeconds` + `visibleSecondsForZoom` (tests updated).

**Deviation from acceptance criteria**: the JSON waveform endpoint keeps exactly one
consumer — `PerfDiffViewer` (PRD lists it out of scope / untouched). Issue 06 must
resolve the conflict before dropping the JSON columns: convert it to `toThreeBands()`
over the blob endpoint (~small) or retire the diagnostic view. Noted there.

tsc clean, 197 vitest, build green. Eye-verify: performance view (both decks + minimaps,
linked zoom), transition editor (stacked half-waveforms, EQ/fader modulation preview,
scroll/zoom), library player beatgrid/cues/readout now visible.

**2026-07-04 post-verify tuning (same change)**: master default 0.78 (headroom — drops
buried markers), soft-knee limiter on group heights (knee 0.6, linear below, asymptotic
to 1; tames hat/snare spikes without dimming the body), minimap master compensation
x1.25 (interim until 05's per-slot params), and a texture-unit clobber fix: modulation
upload bound on the implicitly-active unit 2, replacing the bands 4-7 texture — the
editor rendered automation lanes as high-band energy (user-reported tinted blocks).
