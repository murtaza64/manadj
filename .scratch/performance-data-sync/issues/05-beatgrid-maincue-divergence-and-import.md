# Beatgrid + main cue divergence + import

Status: ready-for-agent

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
