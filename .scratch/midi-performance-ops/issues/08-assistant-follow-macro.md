# Assistant button: Follow-mode macro with lamp

Status: done

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

## Comments

- 2026-07-06 (miditog lane): implemented in jj change `ttuqsxqw` (on top of 07). The
  decision is a pure `followMacroToggles` beside `reduceFollow` (follow flags +
  playing states in, decks-to-toggle out); a `FollowMacroRegistrar` registers the
  app-wide handler (cross-deck, so it registers whole, not per deck) which dispatches
  ordinary `toggle` events — the reducer's loaded gate still applies, so the button
  stays a shortcut over the untouched model (FilterBar, spread/revoke bridge
  untouched). New `follow-macro` target dispatches registry-direct. Feedback:
  `assistantLedLit` (lit iff any Deck follows) + `encodeAssistantLed` over an optional
  `MappingFeedback.assistant` address; an `AssistantFeedbackPublisher` subscribes to
  the follow store (all change sources funnel through it) and resends on output-set
  changes (connect sync). The Inpulse binding and lamp address are UNKNOWN — per the
  handoff, nothing inferred: matcher and address are documented TODO(hardware-verify)
  comment blocks in the mapping awaiting the inspector pass, so the shipped device is
  inert on this button until learned. Covered at the macro, translator, dispatch, and
  LED seams; full vitest (1194) + tsc build green. Status → ready-for-human: review at
  http://localhost:5393 (lane miditog); walkthrough in the review request.
- 2026-07-06 (miditog lane): assistant button hardware-learned via the inspector
  (note 0x03, channel 0 — the browse channel) and bound; lamp wired at the button's
  own address. Macro and lamp both verified on device by the user
  (hardware-verified comments in the mapping). SHIFT+assistant not captured; unbound.
  Landed on main (merge `llmzovqv`). Closed.
