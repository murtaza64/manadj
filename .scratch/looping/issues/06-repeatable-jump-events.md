# Repeatable Jump events: loops survive Take promotion

Status: done (implemented, change xuxtsvot)

## Parent

`.scratch/looping/PRD.md`

## What to build

Loops need no new Transition vocabulary (glossary, Jump event): a **Jump event gains a repeat count** k ≥ 1. A count > 1 is only coherent on a backward Jump, whose repetition period is definitionally its displacement magnitude — jump back N beats, replay N beats, jump again — so there is no period field; the model rejects repeated forward jumps.

The capture pipeline already records loop wraps as playback discontinuities. Extend the vectorizer (ADR 0020's discrete-gesture rule): a loop engagement on the incoming deck inside the Take window collapses to **one** repeated Jump event — displacement = the loop length, count = the number of wraps — rather than k separate jumps. Promotion carries it into the Transition unchanged, and editor audition replays the repeats faithfully: a 4-beat loop held for 8 bars during a live mix arrives in the editor as a single legible, editable Jump event and sounds like what was played.

## Acceptance criteria

- [ ] Jump events carry a repeat count; count > 1 with a forward displacement is rejected at the model boundary
- [ ] A Take with a held loop vectorizes to one repeated Jump event (correct displacement and count), not k jumps
- [ ] Editor audition of a Transition with a repeated Jump reproduces the loop audibly; the event is editable/deletable like any Jump event and persists on promotion
- [ ] Hand-authored single jumps (count 1) are unchanged in model, editor, and playback
- [ ] Vectorizer tests: wrap-run collapse, displacement/count derivation, coexistence with ordinary jumps in the same Take; model tests: backward-only validation

## Blocked by

- `03-minimal-audible-loop.md`

## Comments

**2026-07-05 — Done** (jj change `xuxtsvot`, workspace looping). Model: `JumpEvent.count?` (k ≥ 1, no period field) with `jumpRepeatCount` as the boundary — a count on a forward/zero jump reads as 1 (backward-only validation). New internal `expandedJumps` expands a repeated Jump into k point jumps spaced by |deltaSec|/rateB mix-seconds; `bTrackTimeAt` and `walkB` (hence `bContentSegments`/`bEndMixTime`, the DAW splice, and MixPlayer audition) walk the expansion, so a repeated Jump replays audibly and splices per repeat with zero new machinery downstream. Capture: new `loop` CaptureEvent (engage/resize/translate carry the region + playhead, release carries null), fed by the recorder's snapshot diff; the detector default-cases it as evidence; backend Take events are an opaque list — count and loop events persist for free, as does the count on the promoted Transition's JSON payload. Vectorizer: `loopJumps` collapses each incoming-deck loop segment to ONE backward Jump — displacement = the loop length, count = wraps derived purely from region + engage playhead + rate (never guessed from 1 Hz ticks; a loop open at the window end counts to the end); `jumpTotal` folds count into the bInSec back-projection; outgoing-deck loops drop (incoming-only). Editor chip shows `×k`; drag/edit/delete paths untouched (index-based, count rides the spread). Tests: mixModel repeatable-jump block (validation, replay, period×rate, per-repeat segments, end-time extension, forward-once, count-1 parity); vectorizer loop block (collapse, open-at-end, single-wrap, no-wrap, outgoing-drop, coexistence, rate scaling).
