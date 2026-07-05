# Vectorize discrete gestures into Jump events

Status: ready-for-agent

## Parent

`.scratch/transition-takes/PRD.md`

## What to build

Extend the vectorizer: beat jumps and hot-cue presses on the **incoming** deck inside the Take window become **Jump events** in the derived draft (glossary; ADR 0020's discrete/continuous line — discrete gestures are intentional structure, preserved; continuous ones were already collapsed in issue 03). The effect surfaces automatically in the existing open-Take flow: a doubled buildup performed live arrives in the editor as a draft with the jump in place, audible on audition, editable like any Jump event, and promoted with the Transition.

Outgoing-deck discrete gestures are dropped at vectorization (incoming-only for now, per ADR 0020); they remain in the raw slice for a possible later both-decks extension.

## Acceptance criteria

- [ ] A Take containing an incoming-deck beat jump (e.g. jumping back to double a buildup) vectorizes to a draft with a corresponding Jump event; audition reproduces the doubled buildup
- [ ] A hot-cue press on the incoming deck mid-mix vectorizes to a Jump event
- [ ] Outgoing-deck jumps/hot-cues are ignored by the vectorizer (and untouched in the stored raw slice)
- [ ] Derived Jump events are editable/deletable in the editor like hand-made ones and persist on promotion
- [ ] Pure vectorizer tests cover extraction: jump position/instant derivation, incoming-only filtering, interaction with alignment already derived in issue 03

## Blocked by

- `01-jump-events-in-model-editor-playback.md`
- `03-take-review-and-promotion.md`
