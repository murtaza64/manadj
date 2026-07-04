# 28 — Editor load performance: buffer cache + draw before decode

Status: ready-for-agent (diagnosed 2026-07-04 with the user; spec agreed —
cache + draw-before-decode, behavior otherwise identical)

## Parent

`.scratch/mix-editor/PRD.md`. Reported by the user after issue 27 landed
(not a 27 regression — inherent since the prototype; ADR 0008 priced a
Load at ~1s fetch+decode and the editor pays it 2-4×).

## Symptom

Opening the Transition editor takes seconds before waveforms and
envelopes render.

## Diagnosis

1. Adopt-on-entry loads both tracks onto the editor's PRIVATE engines —
   fetch + `decodeAudioData` from scratch (`DeckEngine.ts` load path has
   no cache); the shared decks' already-decoded buffers are never reused
   (audio isolation = separate engines). Refresh-straight-into-editor
   also loads the shared decks via mirroring: up to 4 decodes of 2 tracks.
2. All timeline drawing gates on engine durations (0 until decode):
   waveforms AND envelopes pop in only after the slowest decode.

## What to build

1. **Decoded-buffer cache**: module-level `trackId → AudioBuffer` LRU
   (4 entries covers both surfaces; AudioBuffers are not context-bound).
   DeckEngine consults it before fetch+decode and populates it after.
   Mode-switch into the editor (shared decks already hold the pair)
   becomes instant; refresh-into-editor decodes each track once, not
   twice. Eviction: LRU beyond 4; a replaced Load re-fetches naturally.
2. **Draw before decode**: derive row geometry (durations) from the
   waveform response's `duration` field (arrives in ms) so waveforms +
   envelopes render immediately; audio readiness gates transport only
   (play button already does).

## Acceptance criteria

- [ ] Mode-switch into the editor with both tracks loaded on shared
      decks: waveforms + envelopes render with no perceptible decode wait
- [ ] Refresh straight into the editor: each track fetch+decodes ONCE
      (network tab / instrumentation), timeline draws before decode
      completes
- [ ] Transport still gated on decoded audio (no play against a missing
      buffer); park-after-ready behavior unchanged
- [ ] Cache is bounded (LRU 4) and per-track replaced on audio change
      (track-identity/02 replace-audio should invalidate — note the hook)
- [ ] No behavior change in library/performance views (they load the
      same engines through the same path)
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None.
