# Selection-scoped presence Export/Import + per-row default actions

Status: needs-triage

## Problem

The unified view's presence operations (Export to Rekordbox, RBXML generation, Import from Rekordbox) act on ALL missing tracks — the underlying executor operations have no track-id filter. The view therefore hides checkboxes on those sections and labels buttons "all…" (PRD Stories 8, 13, 14 partially deferred).

## Idea

Add track-id scoping to the tracks executor operations (filter the find_missing results by selected ids before acting). Unlocks: checkboxes + "Export N selected" on all sections, and per-row one-click default actions (Story 8).

## Addendum (2026-07-02)

Also in scope: **single-track / selection-scoped tag-assignment export**. No such
operation exists — Engine tag export rewrites the whole playlist tree, Rekordbox
export loops all tracks. Per-row tag-export buttons were removed from the
divergence matrix because they misleadingly ran the whole-library op; restore
them once a track-scoped operation exists (Engine: ensure one track's membership
across tag playlists; Rekordbox: write that track's DjmdSongMyTag rows).
