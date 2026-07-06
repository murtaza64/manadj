# 42 — Set view: O(n) main-thread cost on every interaction (big sets crawl)

Status: ready-for-agent

## Parent

.scratch/sets/PRD.md (human report 2026-07-06, during the conductor batch review)

## Problem

With a large Set open (88 tracks: "FUCKBOY SUMMER VOL 1"), every interaction
in the set list view pays a main-thread long task; the human reports the
whole UI "slowing to a crawl", much worse on the big set than the 18-track
"post-forest" — O(n) in set size. Reported "on main too" (not caused by the
parked conductor-lane stack, though it may compound — see Notes).

Measured (headless Chromium, DPR 2, lane conductor's app @ main+34+38,
2026-07-06): **every row click = one ~75-81 ms long task** in the 88-track
set; the same clicks in the 18-track set = 0 ms. Idle is clean (no leak);
hover sweeps are clean; sustained ladder zoom-in costs one ~480 ms task and
grows the 88 row canvases 11 → 43 Mpx (bounded, doesn't accumulate).

## Repro loop (already built — reuse it)

Playwright harness at `/var/folders/30/r992kzw55nggl3vt8yqkt5780000gn/T/opencode/perfloop/`
(temp dir; `npm i playwright` there, chromium cached):

- `node interact.js <url>` — THE red/green signal: clicks 4 rows in each of
  post-forest and FUCKBOY, prints longtask ms per click. Red = big-set clicks
  ≫ small-set clicks.
- `node profile.js <url>` — CPU-profiles two row clicks (CDP, 0.1 ms
  sampling), prints top-25 self-time functions. WRITTEN BUT NEVER RUN — the
  natural next step for attribution.
- `measure.js` / `stress.js` / `longtask.js` — idle/scroll/zoom loops (all
  green today; kept for regression checks).
- Gotcha: "FUCKBOY SUMMER VOL 1" exists as BOTH a playlist and a Set —
  `getByText(...).last()` (the SETS sidebar section) opens the Set view.

## Status of diagnosis (phases 1-2 done, 3-4 open)

- Loop is red-capable, deterministic, fast, agent-runnable (above).
- NOT yet attributed. Ranked hypotheses, untested:
  1. Selection re-render re-renders all 88 rows (SetDetailPane row stack —
     recently grew rowColumns/rowMarks/overlap-time/loaded-playing marks,
     sets 31/32/35) with no memo bail-out — 88 × per-row work ≈ 80 ms.
  2. Ladder redraw on pane re-render: 88 supersampled row canvases
     (ladderWaveStyle / OverviewLadder; sets 30 + the zoom-polish change
     `symstxyv`) redrawn on unrelated state flips.
  3. Plan recompute on selection change (useSetPlan memo deps too wide).
- **`mkkxptqx` ("ladder clip draws are frame-budgeted — fixes set-open lag
  from 10-min framing") landed on main 2026-07-06 AFTER these measurements**
  — re-run `interact.js` against current main FIRST; it may partially or
  fully fix this. If clicks are still red, run `profile.js` and attribute.

## Notes

- Measure against PURE main (fresh lane, own lane app) — the conductor
  lane's app (5343) carries parked 34+38, whose App-level SetSpaceTransport
  feed (a second useSetPlan assembly, 88 hot-cue queries) is itself a
  candidate compounder; profiling there conflates. If SetSpaceTransport
  shows up in a profile against the conductor stack, comment on issue 34 —
  the conductor lane owner will fix it pre-landing.
- The user's phrasing "possibly waveform changes" fits hypothesis 2.
- Fix policy: bugfix — auto-land after your own verification (the
  interact.js loop is the verification spec; add a unit-level regression
  test only if a real seam exists — e.g. a render-count probe at the row
  stack — per the diagnosing-bugs skill).

## Comments
