# Sync Hot Cues and Beatgrids

Status: needs-triage

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
