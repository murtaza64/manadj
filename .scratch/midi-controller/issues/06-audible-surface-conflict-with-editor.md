# 06 — MIDI dispatch conflicts with the editor's one-audible-surface invariant

Status: closed (fixed by issue 07 — audible-surface arbiter, ADR 0013,
change nvkwunvl. Hardware transport routes to the editor's MixPlayer, CUE
drops there; the DeckEngine tripwire makes the two-clock resume
mechanically impossible. Behavior decided: ROUTE.)

## Problem

The MIDI bridge dispatches deck actions unconditionally in every view
(`MidiControllerBridge.tsx` — by design, so hardware never detaches). The
Transition editor suspends the shared Mixer's AudioContext while mounted
(`TransitionEditor.tsx` ~271, issue 08: one audible surface / one running
audio clock at a time), and `DeckEngine.startAudio` resumes a suspended
context on demand (`DeckEngine.ts:385`).

A hardware PLAY while the editor is open therefore resumes the context the
editor just suspended → two live audio clocks → the exact drift/stutter
pathology issue 08 fixed.

## Direction (architecture review candidate)

The "one audible surface" invariant currently has no owner — it's enforced
by scattered effects (editor suspend/resume, view pause calls) that the MIDI
stream couldn't know about. Candidate fix: an audible-surface arbiter module
that owns suspend/resume and that MIDI dispatch + views consult. See the
2026-07-04 architecture review (top recommendation).

Minimal stopgap if slices 02–05 land first: dispatch consults the current
app view and drops transport/cue actions while the Transition editor is
mounted (or routes them to the editor's MixPlayer instead).

## Acceptance criteria

- [ ] Hardware transport/cue while the Transition editor is open cannot
      resume the shared Mixer's context (no second audio clock)
- [ ] Behavior decided (drop vs route-to-editor) and documented
- [ ] tsc, eslint on touched files, vitest green

## Blocked by

None — but coordinate with midi-controller slices 02–05.
