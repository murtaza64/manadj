# Set playback is a Conductor, not an Audible surface

Status: accepted (sets 04, 2026-07-05)

ADR 0013 built the audible-surface arbiter: playback modes with their own
transport semantics register as surfaces, and one holder at a time owns the
shared Decks and Mixer. A reader arriving at Set playback expects the third
surface — the editor got one (ADR 0022), so surely "play a whole Set" does too.

It does not. Set playback is a **Conductor**: an automation driver over the
performance surface, in the exact mold of the editor's MixPlayer — it loads the
shared Decks through the provider's one Load path, starts and stops their
transports, and streams the plan's lane values through the Mixer's automation
overlay. All playback semantics live in the pure planner
(`frontend/src/sets/planner.ts`, `planStateAt`); the runtime driver
(`frontend/src/sets/Conductor.ts`) only reconciles engines against the
evaluated state per frame. There is no Conductor-owned audio, no third set of
transport semantics, and any view that shows the Decks — above all the
Performance view — visualizes the set as it plays.

Two rules force this shape:

- **Takeover must be seamless.** Any manual deck or mixer gesture stops the
  Conductor entirely while the Decks keep playing as they are — the user grabs
  the controls mid-set and is simply live. That is only possible if the
  Conductor was never more than a hand moving the user's own instruments: it
  stands down and the running state IS the performance state. Concretely: it
  first writes its current automation values into base mixer state (sparing
  the one control the user just moved, whose base value is the gesture
  itself), so the overlay disengage's base-state reapply is inaudible; deck
  pitches stay where the plan left them — the user rides on from the exact
  sounding mix. A true surface with its own playback would have to hand off
  between two worlds mid-audio.
  Conductor transport itself (play/pause, row play buttons) is not a takeover
  trigger — those are controls OF the automation, not gestures against it.
- **Capture invisibility, and its exact end.** Conductor-driven playback must
  never mint Takes (a machine performing a saved Transition is not evidence of
  a handover), but capture must resume the moment the user takes over — that
  takeover continuation is precisely a live mix worth capturing (and the
  foundation of the future practice mode). The recorder already gates on
  `audibleHolder() !== 'shared'` and re-seeds from live state when the gate
  lifts (ADR 0020/0022 machinery), so "invisible while conducting, capturing
  from the first live moment" falls out of claim/release with zero
  capture-side changes.

So the Conductor **registers with the arbiter** (`'conductor'` in the
`AudibleSurfaceId` union) — it needs the claim for the capture gate, for
routing hardware transport at itself (ADR 0019: play/pause mirrors the
Conductor while it conducts; pads/jumps/jog deliberately drop), and for
mutual exclusion against the editor — but the registration is a borrow
protocol, not a playback surface: its `silence()` halts conducting, and when
displaced by an editor claim it stands down without releasing (only the
holder may release; the claimant already owns the decks).

## Considered options

- **A third Audible surface with its own player** (private engines or an
  editor-style session) — rejected: takeover would be a handoff between two
  playback worlds (re-seek, re-pitch, re-mix on the user's gear mid-audio),
  the Performance view would visualize nothing, and ADR 0022 just spent an
  effort retiring exactly this duplication for the editor.
- **No arbiter registration at all** (drive the decks as plain 'shared'
  playback) — rejected: conducted playback would flow straight into Take
  capture (machine performances polluting the Transition history), hardware
  transport would fight the drive loop, and the editor could claim mid-set
  with both drivers running.

## Consequences

- The takeover seam is gesture *detection*, not arbitration: the Conductor
  watches mixer base-state notifications (its own writes go through the
  never-notifying automation overlay, so any notify diff is a human) and deck
  snapshot/transport-event diffs behind a self-op guard. `DeckEngine` grew an
  additive `addTransportEventListener` beside capture's single-slot handler.
- Deck pitches are deliberately NOT checkpoint-restored (unlike the editor's
  borrow): at takeover the user inherits the sounding mix, tempo-match
  included; outside windows the plan already rides at native pitch.
- Per-control takeover (grab one fader, automation keeps the rest) stays
  deferred (PRD out-of-scope); all-or-nothing is what makes "stand down and
  the state is yours" trivially true.
- A paused Conductor still holds the claim: capture stays gated until stop,
  takeover, or displacement — pausing a set and resuming it is one session.
