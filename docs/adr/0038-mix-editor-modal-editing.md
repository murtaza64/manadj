# 0038 — Mix editor modal editing: explicit modes replace gesture overloads

Date: 2026-08-27
Status: accepted

## Context

The Mix editor (ADR 0037; formerly Routine/Transition editor) accreted
gesture overloads on one canvas: scrub-seek, cmd/shift-click slot selection,
drag-selected-to-slide, double-click = jump, alt+double-click = pause, trim
handles, lane breakpoint drags, chop stamp. Double-click-to-jump kept
colliding with UI double-clicks. Every new affordance had to find an unclaimed
modifier-chord on an already-crowded surface. The overloads are the disease;
explicit modes are the cure.

## Decision

The Mix editor is **modal**. A small set of top-level modes gates *pointer
gestures on the timeline canvas* (slot rows and waveform rows). Chrome
(popovers, toggles, transport) and view navigation (seek, zoom) stay modeless.
The modal grammar is **arity-invariant**: the 2-slot pair is just n = 2; the
same modes apply at every cast size.

### Top-level modes (v1)

- **select** (`V`) — the default/resting mode. Click a slot to focus it;
  band-select (drag on the row background); drag a selected slot to
  manipulate it on **two axes** — horizontal = shift/slide material (the
  beat-aligned slide that exists today), vertical = reorder = edit the slot's
  entry offset (the cast re-sorts by entry; see ADR 0039 / #198). Trim handles
  and lane-node drags are select-mode canvas edits.
- **pan** (`H`) — view navigation only. Also available as a **hold-`H`
  momentary quasimode** from any mode (release returns to the sticky mode).
- **jump** (`J`) — structural/temporal edits on a waveform row. A click opens
  the jump popup at the clicked beat on the clicked row (jump vs **pause** is
  an option inside the popup, not a modifier); a span-drag excises the span =
  a **jump pair**; clicking an existing marker selects it (move / retarget /
  delete); deleting a *recorded* discontinuity marker is remove-recorded-jump
  (continuity restored). Single-click replaces the old double-click-to-jump —
  the collision that motivated the whole effort.

### Lane-tool tier (lane-scoped)

Envelope shaping is a **second tier** of tools scoped to a lane strip, active
only when a lane strip is focused (their letter keys do not collide with
top-level `V`/`H`/`J`):

- **chop** (`C`) — the existing chop stamp: shift/drag = rectangular full-cut
  between beat-snapped edges (near-vertical walls); click = 1-beat cut. Lanes
  only. Chop is the **first citizen** of this tier, not a top-level peer —
  because it is lane-only, it does not belong beside the timeline-canvas
  modes.
- **pencil** (`P`, deferred) — freehand breakpoint-envelope draw/redraw.
- **node batch-select** (`B`, deferred) — rubber-band node selection +
  group-drag within a lane.

A lane-local tool indicator shows the active lane tool.

### Modeless (never gated by a mode)

- **seek** — click the timeline background / ruler seeks the playhead, in any
  mode.
- **transport** — space = play/pause, always.
- **wheel** — zoom; wheel-scroll / trackpad = scroll. Always.

### Mode-switch surface

- **Letter keys** are canonical: `V`/`H`/`J` top-level, `C` (+ future `P`/`B`)
  lane-scoped. Digits are optional aliases only — the top-level set is
  deliberately kept off `1–8`, which are the deck-scoped hot-cue keys, so a
  future return of hot-cue authoring (ADR 0037's deferred focused-slot MIDI
  depth) never collides.
- A **toolbar segmented control** shows and sets the active top-level mode.

### Escape doctrine (two-tier)

1. Escape with active selection or an open popover **clears that** first
   (deselect / close), no mode change — matching the app's existing
   Escape-clears-transient-state habit.
2. Escape with nothing transient snaps back to **select** from any mode.

Momentary quasimodes (hold-`H`) auto-return on key release, so Escape never
handles them.

### Persistence & targeting

- **Modes persist within a session** — a mode is a working posture, not
  artifact state; it survives cycling artifacts in the picker. Resetting to
  select on every artifact load would be a per-session re-explanation tax.
- **Pointer gestures target where you click** — the row/lane under the pointer,
  always. No pre-focus step: jump inserts where you click; chop acts on the
  lane you drag.
- **Focused slot** survives only as the *last-touched slot*, consumed by
  keyboard/MIDI affordances that have no click location (and is the hook for
  ADR 0037's anticipated focused-slot MIDI addressing). It is **not** a gate
  on pointer actions.

### Chrome stays always-live

Marker/breakpoint popovers, the jump popup, and the **Linked toggle** (ADR
0037, re-homed between adjacent slot rows) are openable/usable in any mode — a
popover is a focused-object interaction, not a canvas gesture. Trim handles
and lane-node drags are the exception: they are canvas edits and live in
**select** / the lane-tool tier respectively, keeping the other modes'
canvases unambiguous.

## Consequences

- The top-level palette is intentionally small (3) — `select` carries slot
  focus + selection + both drag axes + trims; the lane-tool tier absorbs
  envelope shaping so `select` does not re-accrete into an overloaded catch-all.
- Waveform rows have exactly one structural editor (**jump** mode);
  automation lanes have their own tool tier (**chop**/pencil/node-select).
  "Cut" is never one verb spanning both row types — a temporal excision on a
  waveform is a jump pair, an envelope wall is a chop; conflating them is the
  overload this ADR removes.
- Deferred pencil/node-select have a reserved home (the lane-tool tier) and do
  not have to fight back into `select` later.
- MIDI/hot-cue authoring depth stays deferred (ADR 0037); when it returns it
  addresses the focused (last-touched) slot, off the digit keys the modes
  leave free.

## Alternatives considered

- **Digits 1–4 as the mode switch** — rejected: collides with the deck-scoped
  hot-cue `1–8` space and forecloses focused-slot hot-cue authoring; letters
  are also more mnemonic for a small named set.
- **Chop as a top-level mode** — rejected: chop is lane-only, so it belongs
  with the lane tools, not beside the timeline-canvas modes.
- **One "cut" verb across lane and waveform rows** — rejected: the two row
  types have different models (envelope stamp vs temporal excision);
  overloading one gesture across them reintroduces the confusion modes fix.
- **Single-press Escape → select** — rejected in favour of the two-tier form,
  which matches the app-wide Escape-clears-transient habit.
