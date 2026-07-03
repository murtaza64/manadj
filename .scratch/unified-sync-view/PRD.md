# PRD: Unified Sync View

Status: ready-for-agent

## Problem Statement

Syncing data between manadj and the places tracks live is split across too many tabs: Tracks (presence vs Engine/Rekordbox), Metadata (DB vs file tags), Tag Sync (bulk structure + assignments), plus a separate Disk Import flow. Answering "what needs doing?" requires visiting four screens, and the same underlying subject — one track's existence and agreement across places — is fragmented by mechanism instead of unified by track.

## Solution

A single, smart "Tracks" view inside Sync: an inbox-style work queue showing one row per track matched across all four Surfaces (Disk, Library, Engine DJ, Rekordbox). Rows appear only when they need attention (missing somewhere, diverged fields, unimported files, import candidates), grouped by status with count-chip filters. Each row offers a one-click default action (almost always Export); rows with diverged fields expand into a divergence matrix showing exactly which Surface disagrees on what, with per-field Import affordances. Bulk selection per section. In-sync tracks stay collapsed behind a toggle.

## User Stories

1. As a DJ curating in manadj, I want one view listing every track that needs sync attention, so that I don't tour four tabs to find work.
2. As a DJ, I want tracks missing from Engine DJ or Rekordbox grouped under "Missing downstream", so that I can Export them before a gig.
3. As a DJ, I want tracks present in an external library but not in manadj grouped under "Not in Library", so that I can decide whether to Import them.
4. As a DJ, I want files in my tracks directory that aren't in the library shown as "Unimported files", so that Disk Import is part of the same queue.
5. As a DJ, I want tracks whose fields disagree across Surfaces grouped under "Diverged fields", so that metadata drift is visible.
6. As a DJ, I want count chips (missing / diverged / not in Library / unimported / in sync) that act as filters, so that I can focus on one kind of work.
7. As a DJ, I want each row to show presence badges for all four Surfaces (full words: disk, library, engine, rekordbox; green present / red missing), so that I can read a track's situation at a glance.
8. As a DJ, I want a one-click default action per row (Export to the missing Surfaces; Import to Library for import candidates), so that the common case is one click.
9. As a DJ, I want to expand a diverged row into a matrix showing only the diverged fields, so that I see exactly what disagrees and where.
10. As a DJ, I want the matrix to show the Library value as the truth column, checkmarks for agreeing Surfaces, and the conflicting value for disagreeing Surfaces, so that agreement is visually cheap and conflict is visually loud.
11. As a DJ, I want an inline "← import" affordance on a conflicting cell, so that I can take a downstream value into manadj field-by-field.
12. As a DJ, I want tag divergences shown as a color-coded chip diff (green = in both, red struck-through = in Library but missing on that Surface, orange = extra on that Surface), so that tag drift is readable without a mental diff.
13. As a DJ, I want checkboxes on rows and a select-all per section, so that I can act on many tracks at once.
14. As a DJ, I want a bulk action button per section (Export N selected / Import N selected), so that clearing a section is one operation.
15. As a DJ, I want every bulk action to disclose its scope and side effects before applying (from data the view already has — e.g. "Import 13 tracks from Rekordbox: creates 13 rows in the Rekordbox DB"), and to verify by auto-refreshing the view after apply, so that I never write blind. (Revised 2026-07-02: API dry-runs return counters only and duplicate what the view shows; dry-run round-trips are dropped from the UI. The view is the preview; post-apply refresh is the verification. Backend dry_run flags remain for CLI/API use. RBXML generation is nondestructive and needs no confirmation.)
16. As a DJ, I want unprocessed tracks flagged inline ("exports with no tags"), so that I don't publish uncurated tracks by accident.
17. As a DJ, I want Export to never overwrite a Surface's value with an empty Library value — skip the field and warn me instead — so that data I only have downstream is never destroyed.
18. As a DJ, I want the warning from (17) to point me at manual Import as the resolution, so that the fix is discoverable.
19. As a DJ, I want in-sync tracks hidden by default behind a "Show N in-sync tracks" toggle, so that signal isn't drowned by ~900 green rows.
20. As a DJ, I want to check whether one specific track is synced, so that the view answers point questions too (via the toggle + existing filter/search patterns).
21. As a DJ, I want tag assignments treated as just another per-track field in this view, so that tag drift on a track is handled like key or BPM drift.
22. As a DJ, I want tag structure (categories/tags, their downstream trees) created automatically when an Export needs it, so that structure sync stops being my job.
23. As a DJ, I want a "rebuild tag tree" maintenance action preserved somewhere unobtrusive, so that the old --fresh escape hatch survives.
24. As a DJ, I want the Sync view reduced to three tabs — Tracks (default), Playlists, Acquisition — so that navigation matches how I think.
25. As a DJ, I want writing ID3 tags to files to appear as "Export to Disk" and refreshing from files as "Import from Disk", so that one vocabulary covers all Surfaces.
26. As a DJ, I want Import options limited to what each Surface can actually supply (Engine: key/BPM; Rekordbox: tags/energy; Disk: title/artist/key/BPM), so that impossible actions never render.
27. As an operator, I want action buttons unfilled (outline) with fill on hover, matching the app's sharp-cornered design language, so that the view feels native.
28. As a developer, I want the aggregation computed behind one interface with a per-Surface reader seam, so that the view is testable without Engine/Rekordbox databases.

## Implementation Decisions

- **Domain model** (already in CONTEXT.md): Surfaces (Disk, Library, Engine DJ, Rekordbox); Diverged; Tag structure vs Tag assignment split; Export/Import as the only two verbs, parameterized by Surface and by presence-vs-fields; Export never overwrites a Surface value with an empty Library value (skip + warning; manual Import resolves).
- **Row identity**: Match (path then filename, via the TrackIndex module). A renamed file appears as two rows; accepted for v1, fixed later by the Link concept (.scratch/track-identity/01).
- **Status rollup** per row: missing-downstream, diverged, not-in-library, unimported, in-sync; plus an orthogonal unprocessed warning on otherwise-syncable rows. No dismissal/ignore state in v1.
- **New backend module**: a sync-status aggregator whose single interface computes the unified rows: presence per Surface, diverged fields with per-Surface values, capability info (which Surfaces can supply which fields on Import), rollup status, and no-overwrite warnings.
- **New seam — SurfaceReader**: a small read-only interface (list track refs with path + field values, including tag assignments) implemented by thin adapters: Engine (existing enginedj readers), Rekordbox (existing rekordbox readers), Disk (Scan + read_file_metadata). Library reads the manadj DB directly inside the aggregator. This seam is a deliberate read-only down payment on the ExternalLibrary seam (architecture review candidate 3).
- **API**: one new read endpoint returning the unified rows; action endpoints reuse the existing operations (track export executor, tag writers, track_metadata sync/write/refresh, library import manager) — no new write paths. Bulk = existing operations applied to a selection, dry-run first.
- **Frontend**: rewrite the winning prototype variant properly as the real Tracks tab component. Retire the Tracks, Metadata, and Tags tabs; SyncView tabs become Tracks (default) | Playlists | Acquisition. The tag-tree rebuild action moves to an unobtrusive maintenance control. Sharp corners, outline buttons with hover fill, full-word presence badges.
- **Prototype-derived UI decisions** (from frontend/src/components/UnifiedSyncPrototype.tsx, to be deleted when the real view lands): status-grouped inbox with chip filters; expandable divergence matrix rendering only diverged fields; Library column highlighted as truth; ✓ for agreement, value + "← import" for conflict, dim dot for not-applicable; tag chip diff states both/missing-here/extra-here; per-section select-all + bulk button appearing on selection.

## Testing Decisions

- Module-interface tests per ADR-0002: the aggregator is tested through its single interface with fake SurfaceReaders and the real in-memory DB (alembic-built, existing conftest fixtures). No mocks of internals; no external-library DB fixtures (ADR-0004).
- Test external behavior only: given Surface contents, assert rows, statuses, diverged fields, capability flags, and no-overwrite warnings — not the aggregator's internals.
- Scenario coverage: each rollup status; the user's canonical example (title agrees on Disk+Rekordbox, diverges on Engine); tag assignment diff (missing-here + extra-here); empty-Library-value warning; unprocessed flag; pathless/absent-surface cells.
- Thin TestClient smoke test for the new endpoint (status + shape), mirroring tests/test_smoke_api.py.
- Prior art: tests/test_track_metadata.py (module-interface style), tests/test_matching.py (pure semantics), tests/conftest.py fixtures (db, make_track, FakeSource precedent for fakes at seams).
- Frontend: no automated tests (existing decision).

## Out of Scope

- Acquisition integration (stays its own tab; acquired tracks enter manadj directly and flow out via normal Export).
- Playlist sync (different subject; keeps its tab).
- Persistent Link / Replace Audio (separate tickets); rename-produces-two-rows is accepted.
- Dismissal/ignore states for unwanted downstream tracks.
- Pre-gig checklist framing and "Export everything" affordance.
- Restructuring tag-structure writers beyond auto-create-on-Export + preserved rebuild action.
- ID3 genre field export (.scratch/id3-genre-export).
- Frontend test infrastructure.

## Further Notes

- Sample data and real dry-run numbers (925 tracks; 3 missing on Engine, 4 not in Library) from 2026-07-02 validated the inbox-first layout choice; the matrix-first variant was explicitly rejected as 99% noise.
- The SurfaceReader seam should be designed so candidate 3 (full ExternalLibrary seam) can absorb it rather than replace it.
- Delete frontend/src/components/UnifiedSyncPrototype.{tsx,css} and the dev-only SyncView tab when the real view lands.
