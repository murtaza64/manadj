# 02 — Worklet source, resample mode: retire AudioBufferSourceNode

Status: ready-for-agent

## Parent

`.scratch/key-lock/PRD.md` (architecture: ADR 0018)

## What to build

The tracer bullet: each Deck's audio source becomes the dual-mode pull
worklet, running in RESAMPLE mode only — no stretcher yet, no user-visible
change. Everything the engine does today (play/pause/cue/hot cues/seek/
jumpBeats/pitch/bend/Load/dispose, mayStart tripwire, snapshot clock math)
works identically through the worklet.

- Worklet processor: owns the decoded samples, variable-rate resampling
  driven by the composed rate; position bookkeeping as pure, testable code.
- Engine: source management swaps from AudioBufferSourceNode to the worklet
  node; rate changes stream to the worklet; playhead/anchor math unchanged.
- Sample handover: decide copy vs buffer-cache restructure vs
  SharedArrayBuffer here (PRD notes ~100MB/deck naive-copy residency).
- Bit-perfect at rate 1.0 (verify by ear/null-test against main).

## Acceptance criteria

- [ ] All existing playback behavior intact (full vitest green, hands-on
      smoke: transport, cues, nudge, MIDI jog, editor unaffected)
- [ ] Rate 1.0 output is bit-perfect (null test)
- [ ] Position bookkeeping under vitest (pure: frames in/out per rate)
- [ ] No added latency vs today (stab feel)
- [ ] make typecheck, eslint, vitest green

## Blocked by

None (parallel with 01 — resample mode needs no stretcher).

## Comments

- Implemented (change `key-lock: 02-worklet-source-resample`). Structure:
  pure kernel `worklet/deckSourceKernel.ts` (voices, declick splices,
  linear resample — 19 vitest cases), thin `deckSourceProcessor.ts`
  (bundled via `?worker&url`; self-contained IIFE in prod, verified),
  main-thread `deckSourceNode.ts`, engine swap in `DeckEngine.ts`. The
  composed rate rides an a-rate AudioParam so `setValueAtTime` keeps the
  anchor-clock math exact; start/stop/load are ordered port messages.
- **Sample handover decision: copy + transfer.** Channel data is copied
  out of the AudioBuffer and the copies transferred to the audio thread.
  One extra decoded-track copy resident per loaded deck (~50-100MB);
  the AudioBuffer stays intact in the buffer cache for cross-surface
  reuse (mix-editor 28) and context revival. SharedArrayBuffer rejected
  (needs cross-origin isolation); transferring the cache's own buffers
  would poison the cache. Revisit only if residency hurts in practice.
- Declick moved inside the worklet (voice fade-in/out + splice on
  restart, multiple tails kept like the old per-source envelopes) — this
  is the crossfade machinery issue 03's mode switch reuses.
- Known parity deltas (judged inaudible, for the smoke test to confirm):
  start onset is message-delivery-timed (~1 render quantum, like the old
  `node.start(0)`); a fading tail advances at the current rate rather
  than its retire-time rate (≤5ms); first play on a cache-hit load that
  never touched audio pays one-time addModule latency (decode-path loads
  pre-warm the node).
