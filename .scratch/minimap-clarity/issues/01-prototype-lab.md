# 01 — Prototype lab: minimap mark-clarity variants

Status: ready-for-human
Type: prototype

Build `?view=minimap-lab`, a dev-only page rendering the five variants from
`../PRD.md` stacked, with real track data and a synchronized synthetic
playhead. Throwaway code under `frontend/src/prototype/minimap/`; one
additive gate in the dev-view switch. **Never lands on main** (prototype
policy, docs/agents/parallel-work.md).

## Spec

- Track picker (reuse the `api.tracks.list` pattern from StyleTuningPage) +
  saved-transition picker for guide source; synthetic guide fallback.
- Data: `useWaveformBlob` → `toThreeBands`; `useHotCues`; track
  `cue_point_time`; `computePlayGuides` over `snapshotPairStore()`.
- Variants: baseline, edge-lanes, knockout-bars, quiet-body, hybrid — one
  Canvas 2D draw function each, labeled, at 30px and 44px.
- Shared controls: sweep speed + play/pause, click-to-scrub, played-dim
  toggle, hotcue palette toggle, loop-band toggle.

## Testing Decisions

Prototype constraints: no unit tests. Verification = `npm run build` passes
(type-checks) and a human walkthrough of the lab page against a real track
with hotcues + a saved transition.

## Comments

**2026-07-05 — built; verification walkthrough (lane minimap-clarity, change oyrprrqt, throwaway).**

Open: **http://localhost:5273/?view=minimap-lab** (lane app running; or desktop
shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5273`).

What to look at:

1. Track picker defaults to a track with saved transitions (sorted first,
   annotated `· N transitions`); the status line shows real vs synthetic
   guides/hotcues.
2. Five variants stacked, each at 30px and 44px, one shared sweeping
   playhead. Click/drag any strip to scrub.
3. Press **next guide −10s** and watch the magenta guide marks: edge-lanes
   and hybrid flag the *next* guide (brighter + flag head), passed guides dim.
4. Flip the three toggles — dim played portion, unified hotcue color, loop
   band — and compare across variants.
5. Judge: which variant answers "where am I / where's the next guide /
   where are my cues" fastest at a squint?

Deviations from spec: guides derive directly from saved transitions'
`startSec` (equivalent to `computePlayGuides` with the incoming deck cued at
that transition's bIn) instead of dragging in deck state; hotcue/main-cue
synthetic fallbacks kick in per-track when the real data is empty.

Verified by agent: `npm run build` green; lane app serves the page; real
data confirmed via API (track 9: hotcues + transitions present).
