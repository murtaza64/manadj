# PRD: Practice view — buffer-based playback spike

Status: done (spike passed — the buffer engine it proved was absorbed via deck-consolidation; the view itself was deleted in performance-mode 01, change vmyttqqw)

## Problem Statement

As a DJ curating a library in manadj, I can't work tracks the way I would on hardware: the current library player streams through an `<audio>` element, so beatjumps and cue stabs lag while the browser buffers, and there is no EQ or filter at all. I want to practice transitions, audition tracks, and work hot cues with instant response — and before investing in two-deck features (transition practice, recorded mixes), I need to know whether Web Audio can deliver that at all, or whether this direction requires a native app.

## Solution

A new, isolated **Practice view** containing a single **Deck** backed by a new buffer-based Web Audio engine (ADR 0007): the whole track is decoded into memory, making seek/cue/beatjump sample-accurate and instant. The Deck has the library player's transport vocabulary (play/pause, Main cue, beatjump, Hot Cue jump/preview) plus DJ sound controls: an isolator-style 3-band EQ, an HP/LP sweep filter, and a varispeed pitch fader. The UI is deliberately barebones — a track picker, transport buttons, sliders, and a dumb seekable timeline (no waveform). The spike passes or fails against explicit perceptual criteria; failure triggers scoping a native app before any two-deck work.

## User Stories

1. As a DJ, I want to open a Practice view separate from the Library, so that I can work a track without disturbing my curation workflow or the existing player.
2. As a DJ, I want to search for and load any library Track into the Deck from within the Practice view, so that the view is self-contained.
3. As a DJ, I want a visible loading/decoding state when a track loads, so that I know the Deck isn't ready yet.
4. As a DJ, I want play/pause on the Deck, so that I can control playback.
5. As a DJ, I want the Main cue behaviors I know from the library player (set cue when paused off-cue, hold-to-preview from cue when paused at cue, return-to-cue-and-pause when playing), so that cue work feels like hardware.
6. As a DJ, I want cue presses to produce sound instantly, including rapid repeated stabs, so that cue juggling feels responsive.
7. As a DJ, I want to beatjump forward/back by a fixed beat count with no audible click or lag, so that I can navigate a track musically.
8. As a DJ, I want to jump to a Track's persisted Hot Cues, so that I can navigate to my saved positions instantly.
9. As a DJ, I want hold-to-preview on Hot Cues while paused (release returns to the cue), so that I can audition sections quickly.
10. As a DJ, I want a 3-band EQ where pulling a band fully down kills it completely (no residual bleed), so that I can practice bass swaps the way a real mixer allows.
11. As a DJ, I want to boost each EQ band up to +6dB, so that the EQ range matches hardware conventions.
12. As a DJ, I want EQ moves to sound smooth (no zipper noise or clicks), so that sweeps are usable mid-track.
13. As a DJ, I want to reset an EQ band to flat with a double-click, so that I can recover quickly.
14. As a DJ, I want a single HP/LP sweep filter (center = off, one direction = low-pass, other = high-pass), so that I can practice filter transitions.
15. As a DJ, I want a varispeed pitch fader (±8%) with a reset control, so that I can hear whether varispeed-only tempo adjustment is acceptable for transitions.
16. As a DJ, I want a seekable timeline with a playhead, bar ticks derived from the Beatgrid, and Hot Cue markers, so that I can aim clicks and orient myself without a waveform.
17. As a DJ, I want a time/beats readout, so that I know where I am in the track.
18. As a DJ, I want playback to stay glitch-free while I interact with the UI, so that the spike honestly measures the platform.
19. As the developer, I want the engine exposed as a small framework-free interface, so that a second deck, a waveform renderer, or a native-app backend can build on or replace it without rework.
20. As the developer, I want the spike's verdict recorded against explicit pass/fail criteria, so that the web-vs-native decision is made deliberately.

## Implementation Decisions

- **Parallel stack** (ADR 0007): a new buffer-based Web Audio engine; the existing `<audio>`-element library player is untouched. No code sharing with the existing audio context — cue/hot-cue semantics are reimplemented in the engine.
- **Engine is framework-free TypeScript** with a small public interface: load, play, pause, seek, beatjump, cue down/up, hot cue down/up, EQ band gains, filter position, pitch, plus playhead access (subscription or rAF polling). React is a thin adapter that renders state and forwards input.
- **Buffer playback mechanics**: fetch the full audio via the existing track-audio endpoint, decode with `decodeAudioData`; `AudioBufferSourceNode`s are one-shot, so every seek/pause recreates the source node and the engine keeps its own playhead clock against `AudioContext.currentTime`.
- **Declicking**: seeks/jumps/stops use short (~5ms) gain micro-fades so seams don't pop — required for the beatjump criterion to be judgeable.
- **Transport/cue state machine is a pure module** inside the engine, separable from the Web Audio graph (the testing seam if the spike graduates).
- **EQ topology**: isolator-style — signal split into three parallel bands via Linkwitz-Riley crossovers (cascaded `BiquadFilterNode`s) at ~250Hz and ~2.5kHz (tweakable constants), per-band `GainNode`, summed. Range +6dB to full kill (gain 0). Parameter changes are ramped, never set instantaneously.
- **Sweep filter**: one bidirectional control mapping to an HP or LP biquad chain; center detent = bypass.
- **Varispeed**: `AudioBufferSourceNode.playbackRate`, ±8%; pitch shifts with tempo (no keylock).
- **Beatjump** derives seconds-per-beat from the Track's BPM, as the library player does; fixed 32-beat jump matches existing behavior (constant, easy to change).
- **Hot Cues are read-only** in the view: jump/preview using persisted cues; no set/delete UI (may be added opportunistically — it's plumbing, not feasibility).
- **Track selection**: minimal search picker inside the view using the existing tracks-list API. No "open in Practice" entry point from Library in v1.
- **Domain language**: the playback unit is a **Deck** (now in the glossary); the library player is also a Deck, with fewer capabilities.
- **No backend changes.** Audio streaming, track search, and hot cue read endpoints already exist.
- **Browser scope**: desktop Chrome only.

### Pass/fail criteria (the spike's purpose)

Judged by ear/feel in desktop Chrome:

1. Cue / hot-cue press → perceptually instant sound, including rapid stabs
2. Beatjump instant, no click/pop at the seam
3. EQ kill sounds like a real isolator; band sweeps have no zipper noise
4. Sweep filter sweeps smoothly to full effect
5. No dropouts/glitches during UI interaction or while another track decodes
6. Load-to-ready under ~5s for a typical track

Verdict logic: all pass → Web Audio remains the platform; choose the next slice (waveform on the new clock, keylock worklet, or second deck). Criteria 1/2/5 fail after honest optimization → scope a native app before building deck two. Only 3/4 fail → DSP tuning problem, not a platform problem.

## Testing Decisions

- **No automated tests in the spike.** Acceptance is perceptual (latency, kill quality, glitch-freeness) and the backend is untouched; standing up a frontend test harness for throwaway-risk code is premature.
- **The seam is the engine's public interface.** The transport/cue state machine is kept pure and graph-free so that, if the spike graduates, it gains fake-clock unit tests exercised through the engine interface — consistent with ADR 0002 (tests exercise module interfaces, no mocks). No prior art exists for frontend tests in this repo; the harness decision is deferred to graduation.
- Manual verification loop: `make dev`, load real library tracks, judge against the pass/fail criteria; findings recorded against ADR 0007 (status moves from proposed to accepted or superseded).

## Out of Scope

- Second deck, transitions, crossfader, deck sync
- Keylock/time-stretch (AudioWorklet + stretch engine) — named as the largest untested platform risk
- Mix recording / saved transitions as artifacts
- Waveform rendering in the Practice view (follow-up slice: drive the existing renderer from the new clock)
- Setting/deleting Hot Cues from the Practice view
- "Open in Practice" entry points from Library (incl. harmonic-mixing flows)
- Any changes to the library player or backend
- Cross-browser support

## Further Notes

- ADR 0007 (`docs/adr/0007-practice-view-buffer-based-web-audio-engine.md`) records the buffer-based parallel-stack decision and its consequences (~130MB RAM per decoded track, decode wait, one-shot source-node bookkeeping).
- The engine's playhead clock is deliberately the foundation for everything that might follow: waveform sync, deck sync, and — if Web Audio fails — the interface a native backend would reimplement. The spike's findings survive either verdict.
- Architecture-review candidates 5 (Analysis module) and 7 (waveform renderer consolidation) are the known collision risks for follow-up slices, not for this one.
