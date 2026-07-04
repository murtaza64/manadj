# Archive track (soft deletion)

Status: ready-for-agent

## Origin

Filed 2026-07-04 from the playlist-editing grilling session as "hide
track"; grilled 2026-07-04 (same day) — renamed to **Archived** and
semantics decided. Glossary entry added to CONTEXT.md.

## What to build

A curation verdict on a Track: **Archived** = out of the active Library.
Nothing is deleted; everything is reversible except playlist membership.

### Semantics (decided)

1. **Verdict, not view filter.** An Archived Track leaves default views,
   search, Find Compatible/discovery, and Export. Its record, audio file,
   provenance, and Source Correspondence persist.
2. **Downstream copies: stop managing, keep the sync view honest.**
   Archived Tracks are excluded from Export (no creation, no field
   writes, no ID3 writes to Disk) but still participate in Match, so
   existing Engine/Rekordbox/Disk copies are not misread as external-only
   tracks. Their rows are excluded from the Sync inbox sections (not
   attention-worthy); visible at most behind an opt-in filter. Removal
   propagation downstream is explicitly NOT this issue (future, if
   lingering copies annoy).
3. **Playlists: archiving removes the Track from every Playlist**
   (positions compact). When the Track is in ≥1 Playlist, confirm with
   the count ("also removes from N playlists"); in none, no confirm.
   Unarchiving does NOT restore membership — stated asymmetry.
4. **File stays put.** No moves (would break Match-by-path and downstream
   references). Scan never re-proposes it (the Track still exists);
   Refresh never resurfaces it (Correspondence persists, Source Items
   stay fulfilled).
5. **Transitions** referencing an Archived Track keep existing; they just
   stop surfacing (the Track is out of views and discovery).
6. **Archiving a Track loaded on a Deck is allowed**; the Deck keeps
   playing (Decks outlive views).

### UI (decided)

- **"Archived" pseudo-view** in the playlist sidebar, alongside
  All tracks / Unprocessed, listing archived Tracks with dimmed rows.
- **"Archive track"** in the track context menu in normal views (with the
  conditional playlist-count confirm); **"Unarchive"** in the Archived
  view's context menu. Load and Add-to-playlist stay available there
  (auditioning). No keyboard shortcut.

### Implementation sketch

- `archived_at` timestamp on Track (null = active), Alembic migration per
  repo conventions.
- Default track queries exclude archived; Archived view queries them;
  Export/inbox/discovery paths exclude; Match does not.
- Router tests at the playlists/tracks router seam (ADR-0002 pattern:
  real in-memory SQLite): archive removes from playlists + compacts,
  archived excluded from default list + present in archived list,
  unarchive restores visibility but not membership, Scan does not
  re-propose an archived Track's file.

## Acceptance criteria

- [ ] Archive/Unarchive round-trip via API + context menus
- [ ] Archived Tracks absent from All tracks/Unprocessed/search/Find Compatible; present in the Archived pseudo-view (dimmed)
- [ ] Archiving removes from all Playlists with count-confirm when N ≥ 1; positions compact; unarchive does not restore membership
- [ ] Export skips archived Tracks entirely (including ID3 writes); Match still claims their downstream copies; Sync inbox sections exclude them
- [ ] Scan does not re-propose an archived Track's file; fulfilled Source Items stay fulfilled
- [ ] Router-seam tests per ADR-0002 for all of the above

## Comments

Done (jj xupryqxp). Migration 0015_xupryqxp adds Track.archived_at
(re-parented past waveform/templates 0012-0014). Backend: archive/
unarchive/{track}/playlists endpoints (archive removes from all playlists
via the compacting remove, idempotent, returns removed count);
crud.get_tracks gained archived flag (default exclusion + archived-only
listing; library_total = active only). Export exclusions at each
enumeration site: enginedj/sync + rekordbox/sync export candidates,
enginedj tag playlists, rekordbox tag/energy sync, track_metadata
compare_with_files + apply_update's best-effort ID3 write. Match kept
unfiltered; sync-status rows carry archived flag, roll up in-sync (never
attention-worthy, downstream copies still claimed — divergences stay
visible to opt-in chips). Scan already safe (dedupe by Track filename;
test pins it). Frontend: Archived pseudo-view (dimmed rows), context-menu
Archive (membership-count confirm)/Unarchive, sync-card badge. Tests:
tests/test_track_archival.py (8) + TestArchived in test_sync_status.py
(2). Runtime-smoked on the sandbox clone (archive/unarchive round-trip,
totals).
