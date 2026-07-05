# PRD: Key Lock

Status: ready-for-agent

Grill notes: `.scratch/key-lock/grill-notes.md`. Architecture: ADR 0018.
Vocabulary: **Key Lock**, **Key**, **pitch**, **Nudge**, **Deck** (CONTEXT.md).

## Problem Statement

Beatmatching means riding the pitch fader — but the Decks are pure varispeed,
so every tempo change shifts the Track's Key. The app's harmonic-mixing
features (Key display, Key compatibility, Circle of Fifths) promise a Key
that playback then quietly breaks: two tracks that "mix well" harmonically
clash the moment one is pitched ±4%.

## Solution

Key Lock, as on DJ hardware: a per-Deck sticky toggle (default on). While on,
playback-rate changes on that Deck — the pitch fader and Nudges, the whole
composed rate — leave the Track's Key unchanged. While off, the Deck behaves
exactly as today (varispeed; speed and pitch coupled). Toggling is seamless,
even mid-play. Cue stabs, seeks, and nudges keep their current instant feel
in both modes.

## User Stories

1. As a DJ, I want tempo changes to keep the Track in its Key, so that
   harmonically compatible tracks stay compatible while I beatmatch.
2. As a DJ, I want Key Lock on by default, so that the common case (harmonic
   mixing) needs no setup.
3. As a DJ, I want a per-Deck Key Lock toggle, so that I can choose vinyl
   character (coupled speed/pitch) on one deck while the other stays locked.
4. As a DJ, I want the toggle state to persist across sessions per Deck, so
   that my setup survives a restart.
5. As a DJ, I want to toggle Key Lock while the Deck is playing without a
   click or position jump, so that I can react when I notice chipmunking
   mid-blend.
6. As a DJ, I want Nudges (keyboard and jog) to stay in Key while Key Lock
   is on, so that phase corrections don't wobble the harmony against the
   other deck.
7. As a DJ, I want hot cue stabs and seeks to sound immediately with Key
   Lock on, so that finger-drumming and cueing feel identical to today.
8. As a DJ, I want playback at 0% pitch with Key Lock off to be bit-perfect,
   so that the feature costs nothing when unused.
9. As a DJ, I want the waveforms, beat readouts, and effective-BPM display
   to stay exact with Key Lock on, so that visual beatmatching is not
   degraded.
10. As a DJ, I want two Decks running Key Lock simultaneously without audio
    glitches, so that a full mix can stay locked.
11. As a DJ, I want the Key Lock button next to the KEY readout on each
    deck, lit when on, so that I can see each Deck's state at a glance.
12. As a listener, I want stretch artifacts at typical pitches (±2–8%) to be
    unobtrusive on sustained and percussive material, so that locked
    playback is performance-quality.
13. As the developer, I want the stretcher library chosen by an A/B listening
    bake-off, so that license cost (GPL) is only paid for audible benefit.

## Implementation Decisions

- Vocabulary and semantics are the glossary's: Key Lock is a Deck setting,
  covers the composed rate (pitch × bend), default on, sticky per Deck.
- Architecture per ADR 0018: each Deck's single audio source becomes a
  dual-mode pull worklet (resample = today's varispeed semantics; stretch =
  time-stretch without transpose). The AudioBufferSourceNode path is
  retired. Toggle = worklet-internal mode switch with a short internal
  crossfade at the audible position.
- Latency per ADR 0018 (Mixxx model): read-ahead + prime-and-drop on every
  seek/start/mode-switch. The engine's playhead/anchor math is unchanged and
  stays exact.
- The stretcher sits behind a worklet-internal seam (feed samples, set rate,
  set transpose). Library decided by the bake-off issue: Signalsmith Stretch
  (MIT, first-party WASM) vs Rubber Band WASM (GPL — accepted only if it
  clearly wins by ear). Ties go to Signalsmith.
- The engine keeps one composed rate; Key Lock changes what the worklet does
  with it, never how it is computed. Mixer, tempo math, beatgrids, BPM
  displays are untouched.
- Deck-worklet sample handover (copy vs buffer-cache restructure vs
  SharedArrayBuffer) is decided in the implementing issue; naive copying
  costs ~100MB residency per loaded deck and deserves a look.
- The MixZone gains the toggle button next to the KEY readout (lit = on).
  No hardware Mapping binding yet — a candidate button (likely VINYL) gets
  learned in a later /midi-inspect session.
- KEY readout keeps showing the Track's Key in v1.

## Testing Decisions

- The engine's transport reducer and playhead math tests (playback/
  transport.test.ts idiom) must pass unchanged — the worklet replaces the
  source, not the model.
- The worklet's mode logic and position bookkeeping (read-ahead, prime-and-
  drop accounting, mode-switch splice position) are pure functions/classes
  testable without an AudioContext — same seam philosophy as
  translator/jog (synthetic input in, positions/frames out).
- Audio fidelity (bit-perfection at unity resample, stretch quality, click-
  free toggles) is hands-on-hardware-verified per house style (ADR 0002) —
  no Web Audio mocking.
- The bake-off verdict is a human listening session on a purpose-built dev
  page; the page itself is throwaway prototype code (never lands on main).

## Out of Scope

- The Transition editor's private player (tempo-matched playback). Filed as
  a follow-up — note: it challenges the private-surface architecture (ADR
  0013 family); see grill-notes "Noted tensions".
- KEY readout drift indicator when Key Lock is off and pitch is large
  (follow-up issue).
- Computing/displaying the actual sounding key (rejected: false precision).
- Hardware Controller binding for the toggle (needs a learn session).
- Scratch/vinyl-mode platter behavior (no scratch model exists).

## Further Notes

- Mixxx prior art was decisive twice: the pull/read-ahead latency model
  (EngineBufferScaleRubberBand) and the precedent of swapping scaler
  behavior inside one pull chain.
- The KEY glossary entry and Key-compatibility features silently assume
  locked playback; Key Lock makes that assumption real. Mixing with Key
  Lock off is a deliberate, visible choice.
