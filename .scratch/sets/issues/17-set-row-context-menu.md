# 17 — Set view: track-row context menu

Status: needs-triage

## Parent

.scratch/sets/PRD.md

## What to build

Track rows in the Set detail view have no context menu — the only row
operation is the hover ✕ (remove). Sidebar Set rows got a context menu
in issue 01; adjacency rows got the pin picker in 02. The track rows
themselves are bare.

Motivating case (12's review): an archived track's row shows the
"⚑ archived" mark, and the natural next act — remove from set, or
unarchive — is a right-click away in every other surface but this one.

Candidate operations (to be grilled):

- Remove from set
- Unarchive (when the track is archived)
- Add to playlist ▸ (parity with the library table's row menu)
- Play from here (already a hover ▶; menu duplicate?)
- Suggest insert after (already on adjacency rows; duplicate?)
- Jump to track in library

## Acceptance criteria

- [ ] Right-click on a Set track row opens a ContextMenu (existing
      component) with the agreed operations
- [ ] Archived rows surface the reconciliation acts (remove / unarchive)
- [ ] No behavior change for left-click/drag (reorder, play) paths

## Blocked by

—
