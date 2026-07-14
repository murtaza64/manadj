# DDJ-GRV6 Mapping design

Decisions from the pre-hardware design session (2026-07-14) covering the
ambiguous-control portion of the controller-in-hand grill
(four-deck-performance issue 15). Hardware facts:
`ddj-grv6-hardware.md`. The physical controller remains the authority for
anything listed under verification; nothing here overrides observed behavior.

## Policy

- Repurposing allowed: a Mapping may assign any existing action to a control
  regardless of printed label, provided gesture shape (momentary/toggle/
  continuous) and scope (deck-surface/channel-fixed/global) match. Label
  affinity is a tiebreaker (CONTEXT.md, Mapping entry).
- Where a standard rekordbox behavior has a manadj analogue, prefer it, so
  muscle memory translates to non-manadj booths. Where it has none, the
  control is free real estate.
- Deliberate exception to the standard-behavior preference: IN/OUT as
  beatjump (below) — jump is the dominant gesture for this user and earns
  always-available buttons.

## Decided — deck section

| Control | Action |
|---|---|
| IN/4BEAT tap | beatjump back |
| OUT tap | beatjump forward |
| Shift+IN / Shift+OUT | loop-or-jump-size halve / double |
| IN/4BEAT long-press (distinct note) | loop-toggle engage |
| RELOOP/EXIT | loop-toggle |
| CUE/LOOP CALL ◄ ► | hot-cue walk (new action, below) |
| MEMORY solo tap | unassigned (reserved; chord use below) |

Hot-cue walk: paused-only (playing = no-op, CDJ-faithful); stops = Hot Cues
in position order plus track start as the floor; lands paused and moves the
Deck's persisted Cue to the landed stop (memory-cue-call semantics); no
wrap; quantize ignored.

## Decided — pad modes

Wire fact (E1 MIDI list): every pad mode × deck combo has distinct notes —
no host-side mode tracking needed for input; Feedback addresses each mode's
note block independently.

| Mode slot | Assignment |
|---|---|
| HOT CUE | hot-cue (as in core mapping) |
| HOT CUE shift layer (pads) | hot-cue-clear |
| B.JUMP | sized jumps: odd pads left, even right; four size pairs |
| Beat Loop (shift+B.JUMP) | loop-preset, standard ladder 1/4–32 beats |
| STEMS button | GRID mode: pads 1–8 mirror the on-screen BPM panel in DOM order — shrink, grow, nudge-earlier, set-downbeat, drop-anchor, nudge-later, mark-reset, delete-reset |
| STEMS shift (Pad FX), SAMPLER, Key Shift, Keyboard | inert; SAMPLER reserved (fallback link matrix, below) |

Beat Jump window: derived from the per-Deck jump size — rightmost pair =
configured size, pairs = size/8, size/4, size/2, size. No separate pad
state; Shift+pad7/8 = existing beatjump-size halve/double, so pads and
IN/OUT can never disagree.

## Decided — browse cluster

| Control | Action |
|---|---|
| Rotary rotate | selection-move, owned by the focused browse area |
| Rotary tilt ◄ ► | browse-area-move: sidebar ⟷ table (split view: sidebar → playlist pane → library pane) |
| Rotary press | activate: sidebar-focused = open selection + focus table; table-focused = no-op |
| Rotary tilt ▲ ▼ | selection ±page; shift = top/bottom |
| BACK | focus sidebar |
| Shift+BACK | split-view toggle |
| VIEW | Performance ⟷ Library view toggle |
| DISCOVER | follow-macro |
| Shift+DISCOVER | "known only" toggle |
| PREVIEW | open (leftovers) |

Requires new manadj functionality: browse-area focus ring and a
sidebar browse surface (navigate/activate) — the sidebar is pointer-only
today.

## Track linking — candidates, decide on hardware

Linked semantics per the linked-pairs PRD (symmetric, unordered, toggle;
no-op on unloaded Deck or self-pair). Translator gains a chord gesture
class either way. Feedback: MEMORY LEDs lit iff the addressed pair is
Linked; the favorited-but-unlinked hint stays screen-only.

- A — MEMORY × MEMORY chord: hold one side's MEMORY, press the other →
  toggle Link(focused-left, focused-right). Cross-side pairs only (4/6).
- B — MEMORY + DECK chord: hold MEMORY → source = that side's focused
  Deck; press DECK 1–4 → toggle Link(source, target). All 6 pairs. Caveat:
  the DECK press flips the hardware layer (likely unsuppressible) — the
  chord side-effects a refocus. Feedback idea: while MEMORY held, DECK
  LEDs preview linked state (needs verification).
- Fallback — SAMPLER pad mode as link matrix: pads 1–6 = the six pairs,
  LEDs = linked state. Designed, not built.

## New action targets required

- Sized jump (pad-pair jumps derived from the per-Deck jump size)
- hot-cue-walk (prev/next)
- drop-anchor, reset-mark, reset-mark-delete (grid pads 5/7/8)
- browse-area-move, browse-activate, view-toggle, split-view-toggle,
  selection page/top/bottom
- "known only" toggle
- Chord gesture class in the translator
- nudge as a held button target (pending Groove Circuit decision)

## Open questions

- Groove Circuit: entire section open. Proposed but undecided: DRUM RELEASE
  lever → Nudge (gesture shapes match exactly: spring-loaded momentary,
  auto-restore). GAIN, DRUM SWAP 1–4, CAPTURE, DRUM ROLL 1–4 lean
  reserved — candidate future home for phase-4 Set playback controls
  (Pickup wants a lit button).
- Beat FX section (SELECT, CH SELECT, LEVEL/DEPTH, ON/OFF, BEAT ◄ ►);
  Sound Color FX ON/OFF button.
- Leftovers: SLIP, KEY SYNC, MEMORY solo tap, MASTER CUE, BOOTH LEVEL,
  PREVIEW, dual-deck chords, fader start, shift jog variants.
- Shift+BEAT SYNC (set sync master): Tempo Master territory — issue 17.
- Linking gesture choice (A vs B vs matrix): hardware trial.

## Hardware verification list

- Tempo fader physical polarity vs PDF
- Vinyl-on vs vinyl-off platter rotation streams; separate touch note
- Pad note blocks per mode×deck vs current ddjGrv6.ts channel assumptions
- set-control-focus note-60 velocity semantics (0x7f selected / 0 displaced)
- IN/4BEAT long-press note timing/behavior
- DRUM RELEASE lever polarity and message resolution
- Whether the host can override DECK-layer and MEMORY LEDs
- MEMORY+DECK chord feasibility and the layer-flip side effect in practice
- Shifted deck-button note numbers as documented in E1
