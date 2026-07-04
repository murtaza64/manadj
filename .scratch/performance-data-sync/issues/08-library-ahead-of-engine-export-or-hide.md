# Library-ahead-of-Engine divergence: export or hide

Status: needs-triage (direction decision required — grill with the user
before implementation: export support vs. suppressing these rows)

## Parent

`.scratch/performance-data-sync/PRD.md`. Filed 2026-07-04 from the user's
sync-view verification tour (issues 04–07), which closed with this gap
noted.

## Symptom

The div-perf inbox surfaces divergences where the LIBRARY is ahead of the
Engine surface, but every offered action goes the wrong way. Screenshot
case (Release Me — Herbz & Venz, BEATGRID / HOT CUES DIVERGED): hotcue
4·0:46.7 exists in the library (and matches Rekordbox) but is missing in
Engine DJ. The row's only verbs are "Import performance data ← Engine"
(would clobber/ignore the library cue) and "Export fields → Disk". The
row can never leave the inbox by doing the right thing.

## Decision needed (user's framing: one of)

1. **Support exporting performance data → Engine (and/or Rekordbox)** —
   write hotcues/beatgrid/maincue into the external DB. Larger scope:
   Engine DB writes are a new capability (readers exist in `enginedj`;
   writers don't), Rekordbox likely similar. Blob re-encoding, backup
   story, and "never corrupt a device DB" invariants all need grilling.
2. **Don't show library-ahead rows in this view** — the inbox only lists
   divergences the import verbs can actually resolve (Engine has data the
   library lacks, or genuine conflicts). Library-ahead-only rows are
   filtered out (or moved to a read-only "library ahead" group so the
   information isn't lost).

Also worth deciding: mixed rows (Engine ahead on one field, library ahead
on another) — partial verbs vs. whole-row visibility.

## Acceptance criteria (provisional until the decision lands)

- [ ] Decision recorded here (and ADR if option 1)
- [ ] Library-ahead divergences either get a correct-direction verb or no
      longer sit unresolvable in the div-perf inbox
- [ ] Import verbs never silently discard library-only performance data
- [ ] Tests at the aggregator/router seam for the chosen behavior

## Blocked by

The decision above. Implementation of option 1 would likely also need
enginedj write support (new slice).
