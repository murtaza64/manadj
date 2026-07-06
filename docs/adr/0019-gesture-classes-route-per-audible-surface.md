# Gesture classes route per audible surface

Status: accepted (unchanged by ADR 0022, but one rationale aged: "the
editor's private mixer is not hardware-addressable" no longer motivates
keeping mixer-class controls registry-direct — the editor now plays through
the shared Mixer, so those controls audibly affect editor playback, which
is the intended pass-through.)

ADR 0013 routed transport-class gestures (transport, cue) through the
audible-surface arbiter and aimed every other Controller target at the shared
decks unconditionally. That made pads, jumps, and jog inert-or-wrong in the
Transition editor, whose on-screen counterparts mean different things there
(deck A = plain mix transport, deck B = Slide variants — glossary: Slide).

Decision: promote pads (hot cue down/up/clear), jumps (beatjump), and jog to
SURFACE-ROUTED GESTURE CLASSES. The audible surface's registrable handle
grows optional per-class sections; the shared surface registers its existing
deck behavior, the editor registers its gesture semantics, and a class the
audible holder doesn't register is dropped — exactly like CUE on the editor
today. The surface handle also exposes a minimal observable transport state
so LED Feedback can mirror whichever surface is audible instead of lying
while the shared decks are silenced.

Deliberately NOT surface-routed: mixer, pitch, PFL, and beatjump-size stay
aimed at the shared Mixer/decks (they are state, not playback gestures — the
editor's private mixer is not hardware-addressable), and LOAD moves to the
browse-surface registration instead: load policy is VIEW-owned, not
audibility-owned (the editor's assign-to-pair, Performance's load lock, and
the library's free replace differ per view). Amends ADR 0013; ADR 0002's
testing discipline is unchanged (dispatch + surface fakes stay the seam).

Amendment (midi-performance-ops 06 — the grid-edit chord carve-out): while
a grid-nudge pad is held (spin-to-nudge) or a grow/shrink pad is held
(hold-to-jog BPM adjust, in-session addition 2026-07-06), that deck's jog
rim and touch ticks are consumed by the grid-edit chord reducer
(`frontend/src/midi/gridChord.ts`) BEFORE surface routing — they mean the
chord's fine adjustment and reach no surface's jog meanings (no tempo
Nudge, no seek). This deliberately bends "jog routes to the audible
surface": the chords are stored-data edit gestures, and letting their
ticks also bend a playing Deck's tempo would be worse than the exception.
Release restores plain surface-routed jog instantly; the other deck's jog
is untouched (per-deck isolation); the shifted jog-seek stream stays
surface-routed (SHIFT is its own deliberate gesture).
