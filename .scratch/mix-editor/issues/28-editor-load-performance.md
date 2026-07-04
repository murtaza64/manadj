# 28 — Editor load performance: buffer cache + draw before decode

Status: ready-for-human (implemented, change slnsqunq — verify by eye:
mode-switch into the editor should render waveforms/envelopes instantly;
refresh-into-editor should draw the timeline before audio decode lands)

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
      — BY EYE
- [ ] Refresh straight into the editor: each track fetch+decodes ONCE
      (network tab), timeline draws before decode completes — BY EYE
- [x] Transport still gated on decoded audio (engine `ready` semantics
      untouched; cached path lands at loadState 'ready' with a real
      buffer); park-after-ready unchanged
- [x] Cache bounded (LRU 4, tested: eviction/refresh/replace/invalidate);
      `invalidateCachedBuffer(trackId)` exported as the replace-audio
      hook (track-identity/02)
- [x] Library/performance unchanged — same engines, same path, they just
      hit the cache too (cached-load + uncached-fallback engine tests)
- [x] tsc, eslint, vitest 217 green

## Blocked by

None.
