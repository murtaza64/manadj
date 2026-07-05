# Mixer automation overlay

Status: ready-for-agent

## Parent

`.scratch/editor-shared-decks/PRD.md` (ADR 0022)

## What to build

The shared Mixer grows an automation overlay: a distinct write-path that
drives the 10 lane-driven controls (channel fader, 3-band EQ, sweep filter
× both channels) at the audio-node level with **replacement semantics** —
while the overlay is engaged, automation values own those node params; the
user-facing control state (channel states, getters, change notifications)
is never touched by automation writes. Disengaging the overlay reapplies
the base state to the nodes — the reapply lives in the Mixer itself, so no
consumer can forget it.

While engaged, the overlay also pins the crossfader to neutral (both
channels at unity — same math as the existing crossfader-bypass guard),
leaving the stored crossfader position untouched. Trim, master, cue
level/mix, and PFL remain live user controls throughout.

A user moving an overlaid control mid-engagement updates base state as
usual but the node stays automation-owned until disengage (DAW
automation-read behavior).

Overlay writes arrive at animation-frame rate; the existing gain-ramp
discipline (safe re-startable ramps) applies. Graph rebuild/revival while
engaged must restore overlay ownership, not base state.

No consumer in this slice — the Transition editor still plays through its
private mixer. Zero behavior change.

## Acceptance criteria

- [ ] Automation writes to the 10 lane controls never mutate channel
      state, never fire the Mixer's change notifications
- [ ] Engage → write → disengage leaves node params exactly at base state;
      base state observed unchanged throughout
- [ ] Crossfader pinned to unity while engaged; stored position untouched
      and restored on disengage
- [ ] User setter calls while engaged update base state without stealing
      the node from automation; their values land on disengage
- [ ] Graph revival (dispose → use) while engaged keeps overlay ownership
- [ ] vitest coverage at the Mixer seam for all of the above; full gate
      green (pytest + vitest + frontend build + single alembic head)

## Blocked by

None — can start immediately.
