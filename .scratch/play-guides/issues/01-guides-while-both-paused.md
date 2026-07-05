# 01 — Show Play guides while both Decks are paused

Status: resolved

## Problem

Play guides currently require exactly one Deck playing (grill decision: "no
moving reference" when both are paused). Real prep workflow contradicts this:
you cue the incoming Track while the outgoing Deck is paused and want to see
where the press moment sits before anything plays. First user-test hit this
immediately (2026-07-05).

## Decision

Relax the appearance condition: guides also render when BOTH Decks are paused
(both loaded). Both directions may apply simultaneously in that state — Deck
A's guides (A→B Transitions) and Deck B's (B→A) — since either Deck could
become the outgoing side. Keep hiding guides when both Decks are playing.

Details:

- The marker is well-defined while paused: `aTime` depends only on the paused
  incoming Deck's playhead and the saved alignment; it just doesn't sweep.
- With both directions showing, each guide's spanning line/chip/minimap tick
  already self-labels by the incoming Deck's color; the outgoing side of each
  guide determines which Deck's timeline `aTime` lives on — the overlay
  currently assumes ONE outgoing deck per frame (`PlayGuideFrame.outgoing`),
  so the model's frame shape needs to carry per-direction guide sets (or a
  list of frames).
- Appearance-condition changes live in `computePlayGuides`
  (frontend/src/performance/playGuideModel.ts) — extend the tests at the same
  seam (both-paused → both directions; one-playing unchanged; both-playing →
  null).
- Minimap marks: each Deck's minimap shows the guides for which IT is the
  outgoing side.

Grilled 2026-07-05 (confirmed):

- **Both directions at once** while both paused; incoming-Deck color
  disambiguates (A→B magenta, B→A cyan). Starting either Deck prunes to the
  live direction via the existing one-playing rule.
- **Held previews keep counting as playing** (existing predicate untouched):
  holding a cue/hot-cue preview on a paused Deck transiently flips the
  display to the one-playing state and back on release. Accepted — honest
  and momentary; the alternative (excluding previews) projects markers from
  a moving playhead.
- **Missed treatment unchanged**: dimmed-but-visible; with both playheads
  user-placed it reads as "re-cue one of them".

## Out of scope

- Any change to the one-playing behavior.
- Edge affordance for off-screen guides (separate idea, unfiled).

## Comments

Implemented 2026-07-05. `computePlayGuides` now returns `PlayGuideFrame[]`
(one frame per direction); both-paused yields both saved directions, one
playing prunes to the live one, both playing yields none. Overlay positions
each frame against its own outgoing Deck's timeline; minimap shows the frame
its Deck is outgoing for. Tests extended at the model seam (27).
