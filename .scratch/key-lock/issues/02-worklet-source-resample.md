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
