# Quality columns in the Library view (bitrate, filesize, provenance)

Status: ready-for-agent

## Parent

Grilled 2026-07-02 (bitrate/filesize/provenance surfacing). Related: `.scratch/track-identity/issues/02-replace-audio.md` (this view identifies re-acquisition candidates), `.scratch/soundcloud-acquisition/issues/09-asserted-provenance.md` (provenance data).

## What to build

Surface per-track audio quality facts in the Library track list so low-quality tracks worth re-acquiring are easy to spot by sorting and eyeballing. Deliberately **no** computed quality score — raw facts only (revisit once real thresholds are learned).

**Data**: three new Track columns — `codec` (e.g. mp3, aac, flac, wav/pcm), `bitrate_kbps`, `filesize_bytes` — via migration (`<NNNN>_<jj-short-id>`). Computed from the file (mutagen `info` + `stat`) in `backend/track_metadata` (a `refresh_file_facts` pass that owns file-derived Track fields; note: `duration_secs` backfill should migrate into it from the acquisition manager — same change). Write paths: Disk Import for new tracks; one-off backfill script for existing rows (idempotent: fills NULLs; `--force` recomputes all — covers out-of-band file edits). No periodic recompute; Replace Audio must call the same pass when it lands.

**API**: expose the three fields on the Track schema; provenance label (+ URL, asserted) joined onto the tracks list response; all three sortable via the existing `sort_column` machinery (quality sorts by bitrate, lossless treated as top).

**UI** (Library table, `columnConfig.ts`, always-on — no column-toggle system):
- `Quality`: codec+bitrate rendered together (`AAC 128k`, `MP3 320k`, `FLAC`)
- `Size`: human-readable MB
- `From`: provenance label chip (colored like Acquisition's), clickable → provenance URL when present; empty for unknown

## Acceptance criteria

- [ ] Migration adds codec/bitrate_kbps/filesize_bytes; Disk Import fills them for new tracks
- [ ] Backfill script fills existing tracks (~979); idempotent + `--force`
- [ ] Bitrate is codec-aware in display (lossless shows codec name, not a number)
- [ ] Tracks API exposes the fields + provenance; all three columns sortable
- [ ] Library table renders Quality / Size / From; provenance chip links out
- [ ] Module-interface tests: file-facts pass against real audio fixtures (all four formats); duration backfill relocated without regression; thin router smoke for new fields

## Blocked by

None - can start immediately
