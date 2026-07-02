# Link: persistent Track ↔ external-library association

Status: needs-triage

## Problem

Matching between manadj Tracks and external-library rows is recomputed on every Sync run, by path then filename (`backend/sync_common/`). Nothing is stored. So any path change breaks the association, and Sync cannot distinguish "track was renamed" from "track was deleted + new track added".

## Idea

Introduce a **Link**: a stored association between a Track and its counterpart row in a specific external library, keyed by that library's stable internal ID (Engine track ID, Rekordbox content ID).

- Matching (path, then filename) becomes the bootstrap that runs only when no Link exists; its output is a Link.
- Sync operations work over Links, so path changes become in-place updates of the linked external row, preserving downstream history and playlist entries.
- A deleted external row breaks the Link; the next Export re-adds and re-links.

## Notes

- Prerequisite for a clean Replace Audio flow (see 02-replace-audio.md).
- Depends on external IDs being stable across external-library upgrades; verify for Engine DJ and Rekordbox.
