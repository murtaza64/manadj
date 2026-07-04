# Beatgrid + main cue divergence + import

Status: closed (implemented change mrsvnwst; landed in merge vspmwkvl; user-verified 2026-07-04)

## Parent

`.scratch/performance-data-sync/PRD.md`

## What to build

Beatgrid and Main cue join the divergence model and get per-cell External Import, following the tracer laid by the hot-cue slice.

**Beatgrid**: compared by tempo-change structure with a small BPM/offset epsilon. A `generated` placeholder counts as *absent* — Engine's grid imports over it without confirmation; `edited`/`imported` grids are saved info and overwrites are confirmed. Imported grids write origin `imported`. Variable-tempo grids import in full and are flagged "variable grid — N tempo changes" in the sync row and confirm step (manadj rendering honors only the first tempo change — known limitation, out of scope here).

**Main cue**: only an Engine main cue with the overridden flag set participates (Engine auto-defaults are ignored; manadj never persists its own defaults). Compared by time within the shared tolerance. Fill-empty applies without confirmation; overwriting a saved cue is confirmed. Import writes through the normal main-cue persistence path so an imported cue behaves exactly like one set on a Deck, and re-imports are no-ops.

## Acceptance criteria

- [ ] Beatgrid and Main cue participate in sync status for the Engine surface
- [ ] Placeholder (`generated`) grids compare as absent; `edited`/`imported` grids diverge and are confirmation-gated
- [ ] Grid import sets origin `imported`; a later grid edit flips it to `edited`
- [ ] Variable-tempo grids import with all tempo changes and show the "variable grid — N tempo changes" flag in row and confirm step
- [ ] Engine main cues without the overridden flag never appear as importable
- [ ] Main cue import goes through the standard persistence path; re-import is a no-op
- [ ] Sync view renders both cells with textual diffs and confirmed imports via the pending-action flow
- [ ] Aggregator-seam tests for comparison/gating; router-seam tests for import + origin transitions
- [ ] Typecheck and full test suite pass

## Blocked by

- 02-decoders-into-enginedj-package
- 03-beatgrid-origin

## Comments

**2026-07-04 — Done** (jj change `mrsvnwst`, workspace perfdata). `BeatgridValue`/`TempoChangeValue` + `maincue` join the field vocabulary; placeholder (`generated`) grids read as absent at the interface; Engine main cue only crosses when the overridden flag is set (enforced in `performance_fields_from_blobs`, which unifies hotcues/grid/maincue decoding — grid segment-walk math carried over verbatim from the validated script). Comparison: structural grid equality (time tolerance + 0.01 BPM epsilon + bar position), maincue within the shared 1ms tolerance; Library-set + Engine-unset is not a conflict. Import: `POST .../beatgrid/import` and `.../maincue/import` with `fill-empty`/`replace`; grid import writes origin `imported` (later edits flip to `edited`); maincue writes through the waveform cue point (409 without a waveform row). UI: generalized `onImportPerf` callback, GridSummary with "⚠ variable grid — N tempo changes" flag (also in the confirm text), maincue cells, replace verbs confirm via pending flow. Fixed en route: Track.beatgrid/Track.waveform backrefs were accidentally list-valued (now one-to-one); waveform joinedload dragged peaks JSON — replaced with a targeted cue-point column query (real-library status: 21s → 0.27s). Real library: 76 beatgrid / 228 maincue / 7 hotcue divergences; 32 variable grids flagged.
