# 02 — Performance-view toggle + linkable hint

Status: ready-for-agent

## Parent

.scratch/linked-pairs/PRD.md

## What to build

The second toggle surface and the promotion hint.

- Linked toggle in the Performance view, active when both Decks hold distinct loaded Tracks; disabled (not hidden) when only one Deck is loaded or both hold the same Track. Same chain-link icon and stored fact as the editor toggle — the two surfaces always agree.
- Linkable hint on both surfaces: when the loaded pair has ≥1 favorited Transition and no Link, the unset toggle renders a distinct hint state suggesting the pair is linkable. Display-only; never auto-links.

User stories: 1, 3–9, 19.

## Acceptance criteria

- [ ] Toggle works in Performance view with both Decks loaded; disabled for single-load and same-Track cases
- [ ] Linking in Performance view is visible in the Transition editor and vice versa
- [ ] Hint state appears exactly when (favorited Transition exists) ∧ (not Linked); clears on link or unfavorite
- [ ] Toggling with an Archived Track loaded works
- [ ] Pure-model tests for hint/disabled-state derivation; gate green

## Blocked by

- 01-linked-edge-end-to-end.md
