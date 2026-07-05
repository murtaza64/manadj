# 05 — Follow parameters modal + retire the one-shot

Status: done — pending user eye-verify

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

## Comments

- Done (lwmnozwo, lane followmode): `FollowParamsModal` (new, replacing the deleted FindRelatedTracksModal) — live edits via the new `paramsStore` (`manadj-follow-params` preference key; legacy `findRelatedTracksSettings` deleted on boot), no Apply, no reference picker, tags as a single any-shared checkbox, ◆ proven-only control, Reset/Close footer. FilterBar: per-followed-Deck summary chips (`A▸10m·128±4%·E2–4`) via `followSummary` (model, tested), any chip opens the modal; a plain ⟲… chip keeps it reachable while nothing follows (deliberate extra). One-shot fully retired: button group, quick-apply, `deriveRelatedFilters`, `RelatedTracksSettings`, dead CSS — no residue greps. `followedReferences` extracted into the model (was duplicated FilterBar/Library). Review fixes: double-`modal` CSS rename bug (modal chrome was dead), stale comments. Gate: 530 pytest / 535 vitest / build / one head.
