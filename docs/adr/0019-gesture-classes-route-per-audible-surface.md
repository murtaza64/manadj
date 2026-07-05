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
