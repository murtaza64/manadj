# 01 — Mixer owns the audio graph; Practice view deleted

Status: ready-for-agent

## Parent

`.scratch/performance-mode/PRD.md` (ADR 0009)

## What to build

The one-graph refactor: a Mixer module owns the single `AudioContext`; decks become channel inputs.

- Mixer module (framework-free, like the deck engine): owns the context (StrictMode-safe lazy create/revive moves here from the deck), builds per-channel strips — trim → 3-band isolator EQ → sweep filter → channel fader → crossfader gain pair → master gain → always-on limiter (`DynamicsCompressorNode`) → destination. The isolator/sweep DSP moves from the deck's graph into the strip (the pure mapping functions in `graph.ts` are reused).
- `DeckEngine` is constructed against the shared context and a channel input node; it keeps transport, declick envelopes, varispeed, cue/hot-cue semantics, and loses EQ/filter/graph ownership and context creation.
- The provider owns the Mixer and two eagerly-created decks (graph nodes only; no audio memory until Load), but continues exposing only Deck A through the existing `useDeck()` API — no component changes this slice.
- Pure mixer math (trim/fader value→gain, crossfader curve with both-center behavior and end kills) lives in a pure module under vitest.
- The Practice view is deleted (its EQ/filter UI depended on the deck-owned graph). The practice route/sidebar entry temporarily renders the existing layout prototype as a placeholder until issue 03 replaces it.

## Acceptance criteria

- [ ] Library plays Deck A audibly through the mixer graph: channel at defaults is transparent (flat EQ, open filter, unity trim/fader, crossfader center), limiter always in the chain
- [ ] Full library parity: load, play/pause, cue semantics, hot cues, beatjump, scrub, pitch — all unchanged by ear and by the transport tests
- [ ] `DeckEngine` contains no `new AudioContext`, no EQ/filter nodes; the engine's EQ/filter setters are gone (Practice view, their only consumer, is deleted)
- [ ] StrictMode dev double-mount still safe (context revival now at the mixer/provider layer)
- [ ] Mixer math pure functions under vitest (gain mappings, crossfader curve)
- [ ] Practice view deleted; ▸ route shows the prototype placeholder
- [ ] `make typecheck`, eslint on touched files, vitest, pytest all green

## Blocked by

None - can start immediately.
