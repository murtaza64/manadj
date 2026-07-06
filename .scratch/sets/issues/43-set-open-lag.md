# 43 — Set open: seconds of main-thread chop on big sets (post-42 residual)

Status: done — fixed and verified (lane setperf, 2026-07-06); root cause in Comments

## Parent

.scratch/sets/PRD.md (human report 2026-07-06, after 42's fix landed; handoff
`.scratch/sets/handoffs/20260706T0020-set-open-lag.md`)

## Problem

Opening a Set still makes the UI unresponsive for a few seconds (worst on
first/initial load), scaling with set size. Issue 42 fixed **interaction**
jank (row clicks on an already-open set); set **open** was never measured —
this is the follow-on phase. The `symstxyv` ladder framing/supersampling
change is the multiplier that first exposed it.

## Repro loop

Extend the perfloop harness
(`/var/folders/30/r992kzw55nggl3vt8yqkt5780000gn/T/opencode/perfloop/`) with
`openset.js`: from a cold page, click each set in the SETS sidebar (gotcha
from 42: "FUCKBOY SUMMER VOL 1" is playlist AND set — use the sidebar SETS
section / `.last()`), record longtasks for ~5 s after the click, compare
post-forest (18) vs FUCKBOY (88). Red = big-set open ≫ small-set open.
Measure pure main, own lane app; StrictMode doubles dev render cost.

## Ranked suspects (from the sets-30 lane's subagent pass; unverified)

1. **Query-resolution render burst during mount**: per-track hot-cue queries
   at `staleTime: 0` mounted THREE times (SetDetailPane pane copy + two
   useSetPlan instances — plan and previewPlan) → up to 3 waves of N GETs;
   every resolution notifies all three observer sets and re-renders the
   pane. 42's row memo made each re-render cheap, but parent-level work ×
   hundreds of resolutions (doubled in dev) is plausibly seconds of chop.
   Candidate fixes: staleTime > 0, dedupe the triple observer set, or a
   bulk hot-cues endpoint.
2. **One big late commit**: the plan stays undefined until the LAST
   hot-cue/take query resolves, so the ladder (~90 absolute divs + N
   canvases) and all plan-dependent cells mount in one large commit at the
   burst tail.
3. **Request count itself**: 88-track open ≈ 88 blobs (~18 MB) + 264
   hot-cue GETs + 88 track GETs through the vite proxy; even cheap
   handlers × 400+ resolutions = sustained chop.

Cleared already (measured by the sets-30 lane): ladder rasterization
(frame-budgeted, `mkkxptqx`); blob decode ~1.5 ms/track (though re-decoded
per consumer per mount — `useWaveformBlob` memoizes per-hook, only the
ArrayBuffer is query-cached; a free win but not the seconds); no audio
decode on set open.

## Notes

- Fix policy: bugfix — auto-land after agent-owned verification; the
  openset.js probe red→green is the verification spec.
- `useWaveformBlob.ts` is unclaimed but shared by all waveform consumers
  (players, editor) — keep the hook's return shape if touched.
- Related: 42 (interaction jank, fixed), 39 (ladder GL rendering, deferred).

## Comments

- 2026-07-06 lane setperf (ses_0ca73506dffenNsGwWeNDPGGEJ): filing from the
  handoff and taking it. Lane advanced to current main; app on vite 5303.

- 2026-07-06 lane setperf: FIXED. Diagnosis trail:
  - Red loop built (`openset.js` in the perfloop harness): 88-track open =
    **6.7 s total blocked** (81 longtasks, one 730 ms, sustained 60-100 ms
    chop for 7 s); 18-track = 1.4 s.
  - Suspect 1 (hot-cue query burst) was real but SECONDARY: fixing it
    (bulk endpoint, 88 GETs → 1; pane renders/open 52 → 18; max task
    730 → 182 ms) barely moved the total (6.2 s). The chop tracked the 88
    staggered waveform-blob arrivals.
  - **Root cause**: React 19.2's dev-build Component Performance Tracks.
    On every re-render whose props identity changed, react-dom DEV
    deep-diffs old vs new props (`addObjectDiffToProperties`) and
    serializes changed values — and its serializer `for-in` walks objects
    at depth < 3, which for `LadderWave`'s `wave: DecodedWaveform` prop
    meant iterating ENTIRE LOD typed arrays (millions of elements) each
    time a blob arrived (`undefined → object`), 88 times per open, twice
    under StrictMode: ~5.5 s of `debugTask.run` + serialization + GC.
    Confirmed by CDP profile (addObjectToProperties/addValueToProperties/
    run/GC ≈ 6.6 s of a 8 s window; all user code < 300 ms).
  - Fix (three parts, in leverage order):
    1. `LadderWave` now fetches its own blob (trackId prop) — the decoded
       waveform lives in hook state, never in fiber props, so the dev
       props-diff never touches it. RULE OF THUMB for this codebase: never
       pass `DecodedWaveform` (or any typed-array-bearing object) as a
       component prop in dev-mode React 19 — fetch it via hook inside the
       consumer. (Editor/player components already comply: DawTimeline
       feeds waves into a hook, WebGLWaveform/WaveformMinimap fetch
       internally.)
    2. Bulk hot-cues: `GET /api/hotcues/bulk?track_ids=…` (+ crud, tested
       at the router seam in tests/test_hotcues_bulk.py) consumed via one
       shared `useSetHotCues` query by the pane and both useSetPlan
       instances; cue mutations now invalidate the `['hotcues']` prefix so
       the bulk key stays live. 88 hot-cue GETs → 1, one resolution.
    3. `memo()` on OverviewLadder + LadderClip (with stable cue-map /
       EMPTY_CUES identities): clip renders per open 528 → 176 (mount
       only); pane commits no longer cascade into the ladder subtree.
    Plus a free win from the handoff: `useWaveformBlob` now caches the
    DECODED waveform (decode in queryFn) instead of re-decoding per
    consumer per mount; hook return shape unchanged.
  - Verified: `openset.js` 88-track open **6.7 s → 0.2 s** total blocked
    (3 longtasks, max 80 ms, settled < 0.6 s); 18-track 1.4 s → 50 ms.
    42's `interact.js` still green (0 ms clicks both sets). vitest 1267,
    pytest 678 + 3 new, builds, ruff on touched backend files, alembic
    single head.
  - Frontend regression seam: same verdict as 42 — no component-test
    infra; `openset.js` is the lock. Re-run it if waveform data ever
    rides a component prop again or the set-open query fan grows.
