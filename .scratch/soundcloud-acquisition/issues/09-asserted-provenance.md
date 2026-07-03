# Asserted Audio Provenance (acquired-elsewhere)

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md` (extends it; domain decisions in CONTEXT.md + docs/adr/0006-external-sources-url-only.md, grilled 2026-07-02)

## What to build

The acquired-elsewhere story: a Source Item is unavailable on SoundCloud (DRM, deleted) → the user buys/rips the audio elsewhere → Disk Import creates the Track → the user manually links the Source Item to the Track **and asserts where the audio came from**.

- **Schema** (migration `<NNNN>_<jj-short-id>`): `audio_provenances` gains nullable `url` and an asserted/recorded marker; `external_id` becomes nullable; rename `downloaded_at` → `acquired_at`. Native (SoundCloud) download rows also store the permalink URL for uniformity.
- **Origin label**: derived from the URL host (`youtube`, `beatport`, `bandcamp` — strip `www.`, known-host map, else the bare host), overridable; label-only provenance allowed for URL-less origins (`cd-rip`, `unknown`).
- **Manual-link flow** (Acquisition detail panel): the link form gains an optional "audio from" input — paste a URL or type a label; linking then writes both the Source Correspondence and the asserted Audio Provenance. Linking without it behaves as today (association only).
- **Display/sort**: fulfilled view sorts by `acquired_at` regardless of recorded/asserted; badge reads `dl <date>` for recorded, `via <label> <date>` for asserted.

## Acceptance criteria

- [ ] Migration renames/extends `audio_provenances`; existing recorded rows keep working (recorded marker, acquired_at backfilled from downloaded_at)
- [ ] Manual link with a URL writes correspondence + asserted provenance (label derived from host); with a bare label, label-only provenance; with neither, association only
- [ ] Label derivation unit-tested (youtube.com/watch?v=… → youtube + URL kept; unknown host → host as label)
- [ ] Fulfilled view sorts by acquired_at; `via <label>` badge for asserted rows
- [ ] Module-interface tests for the link+assert flow; router smoke for the extended link endpoint

## Notes

- Track-side provenance editor (set/edit provenance on any Track in the Library view) deliberately deferred — noted on issue 07.
- Replace Audio (`.scratch/track-identity/issues/02`) must replace provenance when it lands (CONTEXT.md: provenance describes the current file).

## Blocked by

None - can start immediately
