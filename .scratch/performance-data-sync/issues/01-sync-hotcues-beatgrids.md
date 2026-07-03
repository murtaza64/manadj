# Sync Hot Cues and Beatgrids

Status: needs-triage (Engine→manadj backfill DONE via standalone script; import half superseded by ../PRD.md — remaining scope here is the Export direction and Rekordbox)

## Problem

Hot Cue and Beatgrid Sync is mostly unimplemented. In practice, Hot Cues get set in external libraries (Engine DJ / Rekordbox) while DJing, and there is no easy way to bring them back into manadj — or to push manadj's cues/beatgrids out.

## Idea

Implement both directions for Hot Cues and Beatgrids:

- **Export**: manadj Hot Cues + Beatgrids written into Engine PerformanceData and the Rekordbox equivalent.
- **External Import**: pull Hot Cues set downstream during a gig back into manadj. This is a primary real-world use of External Import.

## Notes

- Existing pieces: `HotCue` model (8 slots), `Beatgrid` model, Engine `PerformanceData` BLOB reading, `backend/beatgrid_utils.py`.
- Waveforms are explicitly out of scope — each library renders its own.
- Cue position semantics may depend on beatgrid/sample offsets per format; verify round-tripping.

## Comments

**2026-07-03 — Engine→manadj backfill done** (jj change `qpswyost`, `scripts/import/engine_performance_data.py`; deliberately kept a standalone script, not reified into the app).

- Decodes Engine `PerformanceData` BLOBs directly: qCompress framing (u32 BE length + zlib); `beatData` (sample rate, default + adjusted grids of little-endian markers); `quickCues` (8 slots: label, sample position, ARGB color; plus main cue + overridden flag). Format per the Mixxx wiki "Engine Library Format" and libdjinterop; validated against the full library (992 tracks, 0 parse errors, grid BPM matches Engine's `bpmAnalyzed`).
- Policy: hot cues fill-empty only (tracks with any manadj cue skipped); beatgrids imported when absent, and existing grids replaced only when they match the auto-generated shape (single change at t=0 with track BPM) — curated grids preserved. Adjusted grid preferred over default; positions converted samples→seconds via the blob's own sample rate; Engine slots 0-7 → manadj 1-8; ARGB → #RRGGBB.
- Backfilled into the real library: 2,500 hot cues across 692 tracks; 823 beatgrids imported + 105 auto-grids replaced.
- Deferred, still open here:
  - 32 variable-tempo grids (multiple tempo changes) — manadj's beatgrid rendering only honors the first tempo change; import once multi-tempo rendering exists.
  - 2 constant grids whose BPM disagrees with Engine's `bpmAnalyzed` (>0.05) — investigate individually.
  - Main cue import: the blob's user-set main cue is decoded (and printed) but not imported; manadj now has its own saved-cue semantics (deck-consolidation 04) — decide precedence before importing.
  - Loops: decoded format known, no manadj model — future concept.
  - Export direction (manadj → Engine/Rekordbox PerformanceData) — untouched.
  - Rekordbox import — untouched.

**2026-07-03 — Import half superseded by `../PRD.md`** (performance-data-sync PRD, ready-for-agent). The PRD reifies the Engine→manadj import into the app (divergence fields + bulk action + overlay diff viewer), resolves main-cue precedence (overridden-flag-only, fill-empty auto, overwrites confirmed), and imports variable-tempo grids with a flag. Still owned by this issue: Export direction, Rekordbox, loops, and the 2 BPM-drift grids (also noted in the PRD's Further Notes).
