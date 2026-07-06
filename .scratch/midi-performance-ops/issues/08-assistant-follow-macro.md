# Assistant button: Follow-mode macro with lamp

Status: ready-for-agent

## Parent

`.scratch/midi-performance-ops/PRD.md`

## What to build

The assistant button (under the browse knob) as a macro over the untouched per-Deck Follow model, registry-direct:

- No Deck follows → enable Follow on all playing Decks; if nothing plays, on both Decks (legal: paused Decks may follow while nothing plays). The press satisfies "turning Follow on from nothing is the user's act".
- Any Deck follows → all Follow off, regardless of which deck had it or how it got there.
- Asymmetric on purpose: adding a second following Deck while one already follows is a screen action, not the button's.
- The decision lives in a pure macro function beside the follow reducer (follow states + playing states in, per-deck toggles out); existing spread/revoke playback rules and the FilterBar toggles stay untouched.
- Feedback: assistant lamp lit iff any Deck follows (mirrors the FilterBar). Learn the button and lamp addresses via the inspector, TODO(hardware-verify) discipline.

## Acceptance criteria

- [ ] Press with no Deck following: playing Decks follow (both Decks if none playing); the browse list filters accordingly
- [ ] Press with any Deck following: all Follow off
- [ ] Existing per-Deck toggles and playback spread/revoke behavior unchanged
- [ ] Lamp lit exactly when any Deck follows, including follow changes caused by playback rules and the screen toggles; synced on connect
- [ ] Macro decision function covered at the follow model's existing seam; translator/mapping tests cover the binding

## Blocked by

None - can start immediately
