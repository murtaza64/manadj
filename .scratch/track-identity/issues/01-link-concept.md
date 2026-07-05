# External Correspondence: persistent Track ↔ external-library association

Status: needs-triage

(Renamed 2026-07-05, formerly "Link" — that name now belongs to the Linked Track-pair assertion. See CONTEXT.md.)

## Problem

Matching between manadj Tracks and external-library rows is recomputed on every Sync run, by path then filename (`backend/sync_common/`). Nothing is stored. So any path change breaks the association, and Sync cannot distinguish "track was renamed" from "track was deleted + new track added".

## Idea

Introduce an **External Correspondence**: a stored association between a Track and its counterpart row in a specific external library, keyed by that library's stable internal ID (Engine track ID, Rekordbox content ID). The sibling of Source Correspondence.

- Matching (path, then filename) becomes the bootstrap that runs only when no External Correspondence exists; its output is an External Correspondence.
- Sync operations work over External Correspondences, so path changes become in-place updates of the corresponding external row, preserving downstream history and playlist entries.
- A deleted external row breaks the External Correspondence; the next Export re-adds and re-establishes it.

## Notes

- Prerequisite for a clean Replace Audio flow (see 02-replace-audio.md).
- Depends on external IDs being stable across external-library upgrades; verify for Engine DJ and Rekordbox.
