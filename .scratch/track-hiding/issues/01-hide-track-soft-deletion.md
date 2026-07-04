# Hide track (soft deletion)

Status: needs-triage

## Origin

Filed 2026-07-04 during the playlist-editing grilling session. Explicitly
out of scope for that work — the track-row context menu built there is
just the natural surface for this action later.

## Problem

There is no way to soft-delete a Track. Tracks that should leave the
active library (bad rips, duplicates, tracks that didn't survive
curation) can only be hard-deleted or left cluttering "All tracks".

## Sketch (undecided — grill before implementation)

- A hidden flag/state on Track; hidden Tracks excluded from default
  library views and (probably) Export
- Entry point: "Hide track" in the track-row context menu
- Open questions: reversibility surface (a "Hidden" view?), interaction
  with playlists containing the track, Sync/Match behavior for hidden
  tracks, what happens to the file on disk

## Acceptance criteria (provisional)

- [ ] Semantics decided (grill): visibility, Export, playlist membership,
      disk file
- [ ] Glossary term added to CONTEXT.md once resolved
