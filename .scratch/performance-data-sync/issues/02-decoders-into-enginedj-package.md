# Decoders into the enginedj package

Status: ready-for-agent

## Parent

`.scratch/performance-data-sync/PRD.md` (also subsumes part of `01-sync-hotcues-beatgrids.md`)

## What to build

Move the Engine performance-data blob decoding out of the standalone import script and into the `enginedj` package as its performance-data decoding surface: qCompress framing (u32 BE length + zlib), `beatData` (sample rate, default + adjusted grids of little-endian markers), and `quickCues` (8 slots with label/position/ARGB, main cue, overridden flag, default cue). The package exposes decoded, typed structures; sample→seconds conversion uses the blob's own sample rate. The script becomes a thin consumer of the package and stays behaviorally identical until its retirement in the bulk-import slice.

This creates the agreed new test seam: bytes in → decoded structures out. Per ADR 0004, no real Engine blobs are committed — tests decode blobs synthesized by a test-local builder implementing the documented format.

## Acceptance criteria

- [ ] `enginedj` exposes decode functions/types for beat data and quick cues (including the overridden flag and default cue distinction)
- [ ] Pytest suite decodes synthesized blobs: grid marker walking, cue slot layout, ARGB→hex, sample-rate plausibility validation, malformed-blob errors
- [ ] No binary Engine fixtures committed (ADR 0004)
- [ ] The standalone script imports the package decoders and its dry-run output is unchanged against the real library
- [ ] Typecheck and full test suite pass

## Blocked by

None - can start immediately
