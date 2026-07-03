# Track-end manual link UI

Status: needs-triage

## Parent

`.scratch/soundcloud-acquisition/PRD.md` (split out of issue 04 during review)

## What to build

The Track-side manual-link affordance: paste a SoundCloud URL on a Track in the Library view to create a Source Correspondence. The backend endpoint (`POST /api/acquisition/link-by-url`) and manager logic already exist and are tested; only the Library-view UI is missing.

## Acceptance criteria

- [ ] A Track's context/detail UI in the Library view accepts a pasted SoundCloud permalink URL
- [ ] Linking marks the matching Source Item fulfilled; unknown URLs surface the 404 detail ("refresh first?")

## Notes

- 2026-07-02: when this is picked up, consider folding in the track-side **provenance editor** (set/edit Audio Provenance on any Track) — deferred from issue 09 (asserted provenance); same Library-view surface.

## Blocked by

None - can start immediately
