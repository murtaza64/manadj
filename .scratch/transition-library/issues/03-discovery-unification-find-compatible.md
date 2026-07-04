# 03 — Discovery unification: Find Compatible from loaded decks + proven-tier switch

Status: closed (implemented change `qwvtkuwo`; user-verified 2026-07-04)

## Parent

`.scratch/transition-library/PRD.md`. Glossary: Compatible, Transition
library, Preferred pair.

## What to build

Rework the existing "Find Related" feature into the two-tier discovery
frame:

- **Rename**: "Find Related" → "Find Compatible" (button, modal title,
  user-facing strings; internal keys may stay).
- **Loaded-deck reference model**: the modal gets A/B buttons (with track
  titles) choosing which loaded deck's track to match from; the
  selection-based reference is retired. Button disabled when no deck is
  loaded. The quick-apply arrow reuses last settings + last chosen deck.
- **Proven-tier switch in the modal**: a "has transition" switch bound to
  the same filter state as the library filter-bar toggle (issue 02) — one
  source of truth, two controls; changing either updates both.
- **Composition**: applying Find Compatible writes only its four criteria
  (keys/BPM/tags/energy); the transition toggle survives. "Clear All"
  clears both axes.

## Acceptance criteria

- [ ] No user-facing "related" strings remain (glossary compliance)
- [ ] Modal opens from a loaded deck (A or B), shows that track's
      key/BPM/energy/tags; switching A/B re-derives the preview
- [ ] Selection in the track list no longer drives the feature; no-decks
      state disables it with a hint
- [ ] Modal "has transition" switch and filter-bar toggle stay in sync both
      directions
- [ ] Applying compatible criteria never clears the transition toggle;
      Clear All clears everything
- [ ] Run "compatible from A" with the toggle on → list shows only
      compatible tracks with saved transitions from loaded decks; deck
      glyphs/stars visible (full discovery loop)
- [ ] tsc, eslint on touched files, vitest green; NOTES.md iteration entry

## Blocked by

- `02-transition-library-discovery.md` (filter toggle + marks must exist
  for the switch/composition work)
