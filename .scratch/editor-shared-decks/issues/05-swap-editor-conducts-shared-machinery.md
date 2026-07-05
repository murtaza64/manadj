# The swap: editor conducts the shared Decks and Mixer

Status: ready-for-agent

## Parent

`.scratch/editor-shared-decks/PRD.md` (ADR 0022 — read it first, plus the
updated ADRs 0009/0013/0018/0019/0021 and the glossary entries: Audible
surface, Transition editor, Take, Slide, Key Lock)

## What to build

The Transition editor plays through the shared two Decks and the one
Mixer. The editor injects the shared engines and Mixer (from the deck
provider) into MixPlayer instead of a private pair; the private Mixer and
its engines are deleted.

End-to-end behavior:

- **Auditions** drive the shared Decks (seek/play/pause/pitch) and the
  Mixer's automation overlay (issue 02) for lane values and mute
  overrides; the overlay engages on the editor's audibility claim and
  disengages on release. Crossfader pinned per the overlay; trim, master,
  cue level/mix, PFL live throughout — PFL headphone cueing now works in
  the editor.
- **Loads**: assigning a track to the editor pair loads the shared Deck
  through the one deck-provider load path (Main-cue defaults included).
  Load mirroring and entry-time adoption logic collapse to "the editor
  edits the loaded pair."
- **Borrowed-deck checkpoint**: per-deck pitch saved on claim, restored
  on release. Transport mutations persist deliberately. Pitch-range
  clamping moves to callers: performance UI/MIDI clamp ±8%, editor
  conductor ±25%; the engine's constructor range constant goes.
- **Key Lock**: the editor plays through each Deck's sticky Key Lock
  (default ON); the "editor engines stay varispeed" carve-out is deleted.
- **Arbiter shrink**: `silence()` = pause playback only; `wake()`-as-
  clock-resume and the `mayStart` tripwire (DeckAudioPort, engine
  startBlocked path) are deleted — this happens IN this slice, not
  before: until the private mixer is gone the tripwire still guards the
  two-clock bug. Audit direct engine-start callers outside arbiter
  routing (follow bridge, boot restore, sibling views) — none may start
  a deck while the editor is audible.
- **Deletions riding along**: the editor's `registerRoutedMixer` call,
  the editor surface's context suspend/resume, the private mixer's
  arbiter-predicate wiring.

## Acceptance criteria

- [ ] Editor audition plays through the shared Mixer: saved master sink
      AND cue/PFL routing work in the editor with no editor-specific
      routing code
- [ ] Exactly one AudioContext exists with the editor open (assert in
      dev/test)
- [ ] Leaving the editor: playback pauses, mixer base state reapplied
      (knobs where the user left them), deck pitches restored, loaded
      pair intact; entering again resumes editing the loaded pair
- [ ] No Takes recorded from editor auditions (issue 03's gate observed
      load-bearing)
- [ ] Performance view after an editor session shows uncorrupted mixer
      and pitch state; ±8% fader never shows an off-scale value
- [ ] Key Lock audibly active during tempo-matched auditions; toggling a
      Deck's Key Lock affects the editor
- [ ] MIDI gesture classes still route per surface (transport/pads/jumps/
      jog in the editor mean mix-transport/Slides as today)
- [ ] Full gate green, plus the manual ear-check list below performed and
      noted in the landing message

Ear-check list: release-reapply pop-free; lane automation smooth at RAF
rate (no zipper/fuzz vs rampGain); stretch artifacts acceptable at large
tempo-match offsets (±25% with Key Lock on); PFL blend in headphones
during audition; return-to-Performance sounds untouched.

## Blocked by

- `02-mixer-automation-overlay.md`
- `03-capture-gates-on-audibility.md`
- `04-prefactor-invert-mixplayer-ownership.md`
