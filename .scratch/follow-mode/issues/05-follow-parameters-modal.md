# 05 — Follow parameters modal + retire the one-shot

Status: ready-for-agent

## Parent

.scratch/follow-mode/PRD.md

## What to build

Rework the Find Compatible modal into "Follow parameters": harmonic keys (bool), BPM (bool + threshold %), energy (bool + up/down/near/equal preset), tags (bool, any-shared — ALL mode dropped), proven only (bool). No Apply button — edits take effect live on the followed list. The reference-deck picker is removed (the per-Deck toggles replaced it).

The FilterBar Follow indicator gains a compact summary of what's being derived per followed Deck (keys/BPM/energy at a glance); clicking the summary opens the modal.

Retire the one-shot: the Find Compatible button group and quick-apply button go away, along with the filter-clobbering derivation path. Parameters move to their own preference key in localStorage, replacing the old find-compatible settings key.

## Acceptance criteria

- [ ] Modal edits change the followed list immediately, with no Apply step
- [ ] Reference-deck picker gone; tags control is a single any-shared boolean; proven-only lives here
- [ ] FilterBar indicator shows a derived summary per followed Deck; clicking it opens the modal
- [ ] Find Compatible button group and quick-apply removed; no code path writes derived values into shared filter state
- [ ] Parameters persist under the new preference key and survive reload
- [ ] Gate green

## Blocked by

- 01-follow-core-manual-toggles
- 03-proven-tier-folded-in (proven-only control)
