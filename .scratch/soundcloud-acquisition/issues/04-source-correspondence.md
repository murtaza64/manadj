# Source Correspondence: matching, proposals, manual link, fulfilled state

Status: ready-for-agent

## Parent

`.scratch/soundcloud-acquisition/PRD.md`

## What to build

The association layer between Source Items and Tracks. Adds Track duration (read from audio files, backfilled for existing Tracks) and the Source Correspondence model (Track ↔ Source item, keyed by the Source's stable ID).

Three-tier matching using Cleanup-normalized title/artist plus duration:

1. Exact normalized match + duration agreement → Correspondence auto-created
2. Above-threshold fuzzy similarity → proposal requiring user confirmation
3. Below threshold → Source Item stays unmatched

A Source Item with a Correspondence is `fulfilled` — regardless of where the Track's audio came from.

UI: per the review-split layout (see the UI decision in the PRD) — proposal review lives in the detail panel: SoundCloud item and candidate Track side-by-side with similarity score, accept/reject; manual link affordances in the same panel (pick a Track for a Source Item; paste a SoundCloud URL on a Track); match score shown in the list row; fulfilled items rendered as such.

## Acceptance criteria

- [ ] Track duration stored and backfilled from audio files
- [ ] Exact matches auto-create Correspondences; fuzzy matches create proposals; below-threshold items stay `new`
- [ ] Accept/reject proposals and manual linking from both ends work in the UI
- [ ] Fulfilled Source Items excluded from the needs-download view
- [ ] Matcher scoring/normalization unit-tested; three-tier flow + fulfillment covered at the module interface with factory-seeded Tracks

## Blocked by

- 02-refresh-end-to-end.md
