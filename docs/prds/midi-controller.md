# PRD: MIDI Controller support — Inpulse 300 MK2 in the Performance view

Status: ready-for-agent

## Problem Statement

As a DJ, I can work both Decks and the Mixer with keyboard and mouse, but that is nothing like the physical instrument I'm building muscle memory for: no jog wheels to ride phase, no real faders to blend with, one hand per deck fighting a QWERTY layout. I own a Hercules DJControl Inpulse 300 MK2 and it does nothing when plugged in.

## Solution

A MIDI Controller layer: plug in the Inpulse 300 MK2 and its jogs, pads, transport, mixer section, and browser controls drive the existing Decks, Mixer, and library browsing directly. The Controller adds no new capabilities — every control binds to an action that already exists on screen or on the keyboard. Mappings are declarative, per-device data files; the Inpulse mapping ships in v1. Input only: no LED/display feedback yet.

## User Stories

1. As a DJ, I want to plug in my Inpulse 300 MK2 and have manadj recognize it without configuration, so that hardware is ready the moment I sit down.
2. As a DJ, I want the play/pause buttons to toggle each Deck's transport, so that starting a track is a physical press.
3. As a DJ, I want the hardware CUE buttons to behave exactly like the on-screen CUE (set Main cue when paused, return-to-cue, hold-to-preview), so that CDJ muscle memory transfers.
4. As a DJ, I want the 8 pads in Hot Cue mode to trigger the Deck's 8 Hot Cues with the existing set/jump/hold-to-preview semantics, so that performance cues are under my fingers.
5. As a DJ, I want a shifted pad mode for beatjump (back/forward, size halve/double), so that phrase-level jumps don't need the mouse.
6. As a DJ, I want rotating a jog wheel on a playing Deck to Nudge it (momentary tempo bend, pitch restored when I stop), so that I can ride phase alignment by hand.
7. As a DJ, I want rotating a jog wheel on a paused Deck to seek, so that I can place the playhead by feel.
8. As a DJ, I want paused-jog seeking to be velocity-sensitive (slow = beat-level precision, hard spin = big travel), so that one control covers both fine placement and traversing a whole track.
9. As a DJ, I want the pitch faders to set Deck pitch across the full ±8% range at fine (14-bit) resolution, so that beatmatching by fader is smooth, not steppy.
10. As a DJ, I want the SYNC button to perform a one-shot BPM match against the other Deck (identical to the on-screen MATCH button), so that tempo-matching is one press while phase stays my skill.
11. As a DJ, I want the per-channel gain, EQ, and filter knobs to drive the Mixer's trim, 3-band EQ, and sweep filter, so that sound shaping happens on real knobs.
12. As a DJ, I want the channel faders and crossfader to drive the Mixer's faders, so that blending is physical.
13. As a DJ, I want the master knob to drive master volume, so that output level is on hardware too.
14. As a DJ, I want the browser encoder to move the library row selection, so that I can browse without touching the keyboard.
15. As a DJ, I want the LOAD A / LOAD B buttons to Load the selected track onto that Deck, so that loading is spatial like on hardware.
16. As a DJ, I want hardware Loads to respect the existing load lock (refused onto a playing Deck), so that a stray press can't kill a live mix.
17. As a DJ, I want deck and mixer controls to keep working when I switch to the library view mid-mix, so that I can always fade out from hardware regardless of which screen is visible.
18. As a DJ, I want unplugging and replugging the Controller mid-session to just work, so that a loose cable isn't a restart.
19. As a DJ, I want unmapped controls (loop section, sampler/slicer/FX pad modes, vinyl button, encoder press) to do nothing, so that stray presses are harmless.
20. As a DJ, I want moving a hardware control to take effect immediately even if the on-screen value differs (jump, no takeover), so that the hardware always responds predictably.
21. As the developer, I want each device's Mapping to be a declarative, typed data file against a closed action vocabulary, so that supporting a second device someday means writing data, not code.
22. As the developer, I want the MIDI layer to call the same actions the keyboard and pointer call (never synthesizing key events), so that input methods stay equivalent and focus-independent.
23. As the developer, I want all MIDI decoding and translation behind one tested seam, so that the layer's semantics are regression-guarded without mocking Web MIDI or Web Audio.

## Implementation Decisions

- **Platform**: Web MIDI API in the frontend. All playback state lives in the browser (ADRs 0007–0009); the backend is not involved. Input only in v1 — no MIDI output (pad RGB, play/cue LEDs, beatmatch-guide lights all dark).
- **Layering**: three parts. (1) A thin **adapter** owning Web MIDI: permission request, port discovery, matching a connected port to a Mapping by port-name substring, hot-plug reconnect via state-change events. (2) A **translator**: raw MIDI messages + a Mapping in, domain actions out. Holds all decoding state: note on/off → button down/up edges, 7-bit and 14-bit (MSB/LSB) absolute values, two's-complement relative ticks, named-modifier (SHIFT) layers, jog velocity math. (3) **Action handlers**: thin glue dispatching actions to existing Deck engine, Mixer, and browse-selection methods.
- **Scope**: the layer attaches once at the app's provider level, above the view switch — deck, jog, pitch, pad, and mixer actions work in every view (the Decks and Mixer are app-owned and keep playing across views). Browse/load actions act on the active browse surface's selection and no-op where there isn't one.
- **Mapping files**: typed TypeScript modules, one per device model, declaring the port-name match and a list of bindings. A binding pairs a message matcher (note/CC, channel, number, control type: button / absolute / relative; absolute may declare 14-bit) with an action from a closed vocabulary (transport, cue, hot cue by pad, beatjump and size, match, jog, pitch, per-channel trim/EQ/filter/fader, crossfader, master, selection move, load by deck). A binding may require a named modifier; whether the Inpulse's SHIFT changes emitted messages in hardware or must be tracked in software is determined during implementation — the schema supports both. Controls with no manadj counterpart are absent from the Mapping.
- **Jog semantics**: playing Deck → Nudge (bend driven by rotation impulses; when ticks stop, bend returns to zero and pitch is restored exactly — the existing bend API, driven by a rotation-activity window instead of key-up). Paused Deck → seek, with velocity-sensitive acceleration (per-tick distance grows with rotation speed). Touch-top capacitive sensing is ignored.
- **Pads**: hardware mode buttons change what the pads emit, so pad modes need no software state. Hot Cue mode binds pads 1–8 to Hot Cues with existing down/up semantics; one shifted mode binds beatjump back/forward and size halve/double. All other pad modes unmapped.
- **SYNC**: stateless one-shot BPM match (same calculation as the on-screen MATCH button, half/double-time candidates, ±8% clamp). No continuous sync-lock exists or is added.
- **Absolute controls**: jump semantics — the incoming hardware value applies immediately; no soft takeover. Rationale: one user, one dedicated controller; the hardware becomes the mixer's physical source of truth.
- **Load**: LOAD A/B invokes the existing Load path including the load lock; a refused Load is silent (no feedback channel on hardware).
- **Known cosmetic gap, accepted for v1**: Mixer state is deliberately non-reactive, so hardware knob moves don't repaint on-screen knobs. Deck state is snapshot-driven and reflects hardware normally.
- **Glossary**: **Controller** and **Mapping** added; **Nudge** widened to cover impulse-driven (jog) bend. No ADR — the platform choice follows directly from ADRs 0007–0009.

## Testing Decisions

- Continue the established seam (ADR 0002, performance-mode precedent): vitest on pure modules; no Web MIDI or Web Audio mocking.
- **One new seam — the translator**: synthetic MIDI messages + a Mapping in, asserted action streams out. Covers button edge derivation, 7/14-bit absolute assembly, relative tick decoding, modifier layers, jog velocity → bend amount and accelerated seek distance, mapping resolution, and unmapped-message silence.
- Downstream of the seam is existing tested surface (transport reducer, mixer math, engine) or thin glue; the adapter (permissions, discovery, hot-plug) and the real device's mapping stay hands-on-hardware verified, per house style.
- Good tests here assert observable action output for message input — never internal decoder state.

## Out of Scope

- Scratch / touch-top vinyl scrubbing (needs reverse/scrub engine capability — its own feature)
- Loops (new domain concept and persisted per-Track data — its own feature; Loop/Slicer/Sampler/FX pad modes stay unmapped)
- Soft takeover / pickup for absolute controls (follow-up if pitch-fader jumps bite; pitch faders first)
- MIDI output: pad RGB, transport LEDs, beatmatch-guide lights
- MIDI-learn mode and runtime-loaded (JSON) mapping files
- Making Mixer state reactive so hardware moves repaint on-screen knobs
- Continuous sync-lock / phase-following
- Mappings for the library view or a future transition mode (the global layer leaves room for them)
- Any device other than the Inpulse 300 MK2

## Further Notes

- Design session recorded in glossary edits on jj change `midi-controller: grill (docs)`: Nudge widened, Controller and Mapping defined.
- The Inpulse's exact MIDI implementation (note/CC numbers, 14-bit pairs, SHIFT behavior, jog tick format) is established empirically against the device during implementation; the mapping file is the single place that knowledge lives.
- Follow-ups noted during design, in likely priority order: soft takeover on pitch faders, MIDI output for pad/transport LEDs, scratch, loops.
