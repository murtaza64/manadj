# Detector tuning pass over real Takes

Status: ready-for-human

## Parent

`.scratch/transition-takes/PRD.md`

## What to build

Not an AFK-agent issue — this needs the developer's ears and real practice data. After mixing with the always-on detector for a while (post issue 02), audit the Transition history: false positives (Takes that weren't real handovers — teases, noodling), false negatives (real handovers that produced nothing — note them as they happen), mis-windowed engagements (cross-cuts split or over-folded). Adjust the versioned detection parameters (audibility threshold, settle horizon, minimums), add synthetic detector tests reproducing each observed failure, and bump the detector version so old Takes remain attributable to the detector that produced them. Promoted-vs-unpromoted status across the history is the labeled signal for judging borderline cases.

If auditing reveals the raw slices are missing data the detector or vectorizer needs, that's a finding for a follow-up issue — the whole point of storing raw slices is that re-derivation stays possible.

## Acceptance criteria

- [ ] A real practice session's history reviewed against memory of what was actually mixed
- [ ] Each observed detection failure reproduced as a synthetic-stream test case before parameters change
- [ ] Parameters adjusted; all detector tests (old and new) pass
- [ ] Detector version bumped; new Takes carry it
- [ ] Findings that need model/schema changes filed as new issues rather than folded in here

## Blocked by

- `02-capture-detector-takes-history.md` (plus real-world usage between)
