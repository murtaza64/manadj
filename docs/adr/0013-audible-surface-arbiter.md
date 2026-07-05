# An arbiter owns the audible surface

Status: superseded in part by ADR 0022 (2026-07-05) — with one AudioContext
the clock invariant is vacuous: `silence()` becomes "pause playback" only,
`wake()`-as-resume and the `mayStart` tripwire are deleted. The single-holder
state machine, gesture routing seam, and claim/release lifecycle survive.

"One audible surface / one running audio clock" (the invariant from
mix-editor issue 08 — two live AudioContexts make both clocks stutter) gets
an owner: a module-level arbiter (`frontend/src/playback/audibleSurface.ts`)
instead of cooperating view effects. Surfaces register a handle —
`{ transport, silence(), wake() }` — and audibility is a single-holder
state machine with `'shared'` (Decks+Mixer) as the permanent default:
`claim` silences the displaced surface and wakes the claimant, `release`
restores the default. Wake resumes the clock only, never playback.
App-wide inputs (MIDI dispatch) route transport-class gestures through the
arbiter's audible handle and stay view-blind; gestures the audible surface
has no meaning for (CUE in the Transition editor) are dropped — hardware
mirrors the keyboard of the audible surface.

Backstop: `DeckAudioPort` grows an optional `mayStart()`, answered by each
Mixer's ports from the arbiter; `DeckEngine.play()` no-ops with a warning
when its surface is not audible. The one place clocks get resumed
(`startAudio`) becomes mechanically unable to break the invariant, without
the engine learning any app policy — the check rides the existing
engine↔mixer seam.

## Considered options

- **Drop hardware transport while the editor is open** — rejected: the
  play button going dead in an increasingly-used mode feels unplugged;
  routing costs nearly nothing once the arbiter carries transport handles.
- **View-consulting dispatch** (MIDI checks the active view) — rejected:
  re-states the invariant inside every consumer (each MIDI slice, every
  future input), and the active view lives in React state the MIDI layer
  can't see. The arbiter answers at one seam.
- **Arbiter-owned AudioContexts** (engines request resume through the
  arbiter) — rejected: inverts ADR 0009's ownership (Mixer owns the one
  context) for no gain over the port tripwire.
- **Claim stack** — rejected until a third surface exists; single holder +
  default covers the whole current state space. Claim-over-claim is
  last-wins with a warning; a third surface re-grills this.

## Consequences

- The Transition editor's mount effect (suspend shared Mixer + pause both
  shared decks) collapses into `'shared'.silence()`, invoked by the
  arbiter on claim. One enforcement site remains in the codebase, and it
  is a pure, Web-Audio-free state machine under vitest.
- MIDI slices 02–05 dispatch against a stable seam: pads/jog/mixer/pitch
  stay aimed at the shared decks (inert while silenced, blocked from
  resuming by the tripwire); transport/cue route through the arbiter.
- Fixes midi-controller/06 (hardware PLAY in the editor resurrecting the
  second clock).
- Future surfaces (offline render, a second controller's target) claim
  instead of re-learning the invariant; the keyboard's capture-based
  editor arbitration could later route through the same handle, but that
  is deliberately out of scope here.
