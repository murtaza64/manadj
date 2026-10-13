# PRD: Rekordbox onboarding import

Feature slug: `onboarding`. Decided 2026-10-06 (grill with Murtaza).

## Problem Statement

A new user arrives with years of curation in Rekordbox. Today the only
in-app path imports bare tracks (title/artist/BPM; key always null — bug in
`executor.import_tracks_from_rekordbox`), enqueues a stem split per track,
and drops hot cues, grids, MyTags and playlists. First run shows an empty
table with no guidance.

## Solution

First run (empty Library) shows a welcome screen: **Import from Rekordbox**,
**Add a tracks directory**, **Skip**. The Rekordbox wizard: detect library →
preview counts → options → run with progress → summary. One bulk External
Import of everything manadj can hold, fill-blanks only, idempotent on re-run
(also reachable later from SYNC).

## User Stories

1. As a new user, my Rekordbox library is found without me typing a path.
2. Before importing, I see counts: tracks (and how many are missing on disk /
   streaming-only), playlists, MyTags, hot cues, grids.
3. Rekordbox can stay open while I import; nothing is written to it.
4. After import my tracks keep their files where they are.
5. Hot cues A–H land in slots 1–8 with colors and labels; the first memory
   cue becomes the Main cue.
6. Beatgrids and keys come across and are not re-analyzed.
7. MyTag categories/tags become Tag Categories/Tags with assignments.
8. Rekordbox Genre values become Tags in a "Genre" Tag Category (toggle,
   default on).
9. Playlists come across in play order; folders flatten to
   `Folder > Sub > Name`; smart playlists import as static snapshots; empty
   folders are skipped.
10. "Recently added" ordering survives (date added → `created_at`).
11. A summary lists what was imported and what was dropped (memory cues
    beyond the first, saved loops, missing files, streaming tracks).
12. Re-running the import adds new Rekordbox content and changes nothing
    already imported.
13. Import progress is visible and the app stays usable meanwhile.
14. "Add a tracks directory" lets me pick a folder in the UI; subfolders are
    scanned.

## Implementation Decisions

- Read from a snapshot copy of the Rekordbox library dir (existing
  `snapshot_library` pattern), auto-detected via pyrekordbox's config
  discovery; Settings path overrides. master.db only — no XML.
- Reuse `backend/sync_performance` (`apply.py`, `bulk.py`) with a Rekordbox
  `PerformanceSource` built from `adapters.py` readers (`rb_hotcues_from_cue_rows`,
  `_rb_beatgrid`, offset correction). Grids `origin="imported"`, keys
  `key_provenance="imported"` (via `djmdKey.ScaleName`, not `KeyID`).
- Fix pink-cue color bug (`adapters.py:254`, `Color=0`) and legacy
  `Color=255`/`ColorTableIndex` cues.
- Enqueue waveforms and missing analysis only; **never** enqueue stems on this
  path (stems onboarding is a later, separate flow).
- Run as a task (ADR 0003) with progress; the wizard polls it.
- Energy: not imported (keep simple). Rating, comments, album, label, year,
  play count, history: not imported.
- Playlist folders: skip `Attribute` folder rows as playlists; smart playlist
  membership is evaluated by Rekordbox's stored result if available, else
  skipped with a summary note.
- First-run detection: `library_total === 0`.
- `lane_app.py start --empty-db` (fresh alembic schema, no clone) for demo and
  testing; lane config must not point at Murtaza's real tracks directory.
- Rekordbox path and tracks directory come from app configuration (see
  `packaged-app.md`); the tracks-directory step is blocked on it.

## Testing Decisions

- Backend: import against a fixture master.db built with pyrekordbox (or a
  copied tiny library) asserting tracks, cues, grid, key, tags, playlists,
  idempotent re-run. Tests exercise the import module interface (ADR 0002).
- Demo: empty-DB lane app, importing Murtaza's real Rekordbox library from a
  snapshot (read-only).

## Out of Scope

Memory cue / saved loop models, playlist folder model, Energy mapping, XML,
Engine DJ onboarding import, writing to Rekordbox, stems onboarding.
