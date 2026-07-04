# Hot cue divergence + per-cell import

Status: ready-for-human (implemented, change ksxmytzl; landed in merge vspmwkvl — verify import UI by eye)

## Parent

`.scratch/performance-data-sync/PRD.md`

## What to build

The first full tracer: Hot Cues become a Diverged-comparable field between the Library and the Engine Surface, end-to-end. The Engine surface reader decodes quick-cue blobs (via the enginedj package) and supplies cue sets; the sync-status aggregator compares them as whole sets — slot occupancy, time within a tunable tolerance (~1 ms), label, and color; the sync view shows the diverged cell (textual diff: slots/times/labels — the overlay viewer is a later slice); a per-cell External Import applies Engine's cues.

Import semantics per the PRD: when manadj has no cues, import applies without confirmation; when manadj has any, the user confirms and chooses *fill empty slots* or *replace all*. Imported cues land at Engine's exact positions — the set-cue beat-quantization is bypassed. Identical sets read as in-sync, making re-imports no-ops.

## Acceptance criteria

- [ ] Hot Cues participate in sync status for the Engine surface (diverged / in-sync / fill-empty cases)
- [ ] Whole-set comparison honors the time tolerance (single tunable constant) and treats label/color differences as divergence
- [ ] Import endpoint supports fill-empty-slots and replace-all; overwriting saved cues requires the confirmed verb, never happens implicitly
- [ ] Imported cues are not quantized to the beatgrid
- [ ] Re-import after import is a no-op (in-sync)
- [ ] Sync view renders the diverged cell with a textual cue-set diff and wires both import verbs through the existing pending-action confirm flow
- [ ] Aggregator-seam tests (fake surface readers) for comparison semantics; router-seam tests for import behavior
- [ ] Typecheck and full test suite pass

## Blocked by

- 02-decoders-into-enginedj-package

## Comments

**2026-07-04 — Done** (jj change `ksxmytzl`, workspace perfdata). Hot Cues are a Diverged field end-to-end: `HotCueValue` + `TrackFields.hotcues` in the sync-status vocabulary; whole-set comparison in the aggregator (`HOTCUE_TIME_TOLERANCE = 1ms`, labels None-normalized, colors case-folded); `EngineSurfaceReader` decodes blobs via the new `backend/sync_performance` package (`hotcues_from_performance_blobs`, samples→seconds, slots 0-7→1-8, decode failure → None). Import: `POST /api/sync/performance/hotcues/import` with `fill-empty`/`replace-all` (`EnginePerformanceSource` dependency, overridable in tests); direct row writes bypass quantization. UI: `div-perf` inbox group, HotCueDiff chips (colored dots, TagDiff semantics), fill/replace verbs — replace-all through the pending-confirm flow. 18 tests (aggregator + router seams). Real-library check: 996 rows in 0.17s, 7 genuine hotcue divergences.
