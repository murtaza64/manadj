# Deck controls: consistency across modes

Grilled 2026-07-04. Companion ADR: 0016 (BPM is a projection of the
Beatgrid). Glossary: Alignment nudge, Beatgrid (anchor + projection).

## Problem

The same control classes (transport, hot cues, beatjump, grid edit, BPM
edit) appear in the library view, Performance view, and Transition editor
with slightly-to-vastly different design and implementation: three BPM
input idioms with three commit paths; the BPM→grid-regen ritual
copy-pasted 3× (one serialized, two racy); the editor's hot-cue row
bypassing `useHotCueActions`; three beatjump behaviors behind identical
◀◀/▶▶ glyphs with unlinked size state; two visually-identical ±10ms pairs
in DeckCard meaning different things; a parallel CSS dialect
(`editor-pair`/`editor-cueslide`) beside `player-button`.

## The three control classes (design vocabulary)

Consistency means something different per class:

1. **Curation controls** — edit stored Track data: grid nudge, set
   downbeat, BPM edit, hot-cue set/delete. Bit-identical semantics in
   every mode; ONE shared implementation each.
2. **Playback controls** — act on a live deck: play/cue, beatjump (as
   transport), pitch/Nudge/match, hot-cue trigger. Shared components
   wherever a real deck plays (library, Performance), parameterized only
   by density (`perf-mini`) and keyboard hints.
3. **Alignment gestures** — the Transition editor's re-purposed
   vocabulary (glossary: Slide, Alignment nudge): same physical controls
   and layout as class 2, deliberately different semantics, marked by ONE
   systematic visual cue — a dedicated alignment accent color on control
   borders/labels — replacing the accidental parallel design language.

## Decisions

- BPM⇄Beatgrid: ADR 0016 — grid is tempo authority; BPM edit is a
  server-side grid operation switched on origin; user-marked downbeat
  persists as the grid's anchor; re-tempo never moves the anchor; grid
  nudge shifts anchor along. Variable grids: readout `~N (var)`, no
  single-BPM edit (flatten verb deferred).
- Beatjump size: ONE per-deck value (DeckContext), default 32, adjustable
  in-session (PERF's method) — library gains the −/size/+ stepper, the
  editor's gesture cluster reads the same number, MIDI `beatjump-size`
  will target it.
- PERF's on-screen PLAY adopts latch-while-loading (keyboard already
  latches everywhere).
- Editor hot-cue row rewires onto `useHotCueActions` with the gesture
  trigger injected (set/delete stay shared curation; press = Slide/jump
  per deck).
- `store.nudgeTrack` renames to the glossary term (Alignment nudge).
- Duplicated `ScrubTransport` literals and cue pointer-capture pattern
  merge into the shared components.
- Keyboard: three guard implementations converge on one helper
  (`isGuardedKeyEvent`); per-mode key MAPS stay per-mode (deliberate).

## Icon language (added 2026-07-04, second grill round)

Left/right-coded operations stop sharing glyphs; the accent color says
which CLASS, the icon says which OPERATION. A small shared SVG icon set
(`components/icons/`) — unicode only where it survives 11px:

- **Beat jump** (and the editor's slide-beatjump, accent-marked): curved
  jump arrow (↶/↷ shape, drawn).
- **Nudge/bend**: ◀◀ / ▶▶ — momentary speed change reads as rewind/FF.
- **Grid nudge**: grid-ticks-with-arrow (drawn) — clearly a grid op.
- **BPM step**: grid compress `→←` (BPM up) / spread `←→` (BPM down) —
  ADR 0016 made visible; replaces generic ± steppers.
- **Halve/double anything** (beatjump size, PERF BPM shortcuts): text
  `1/2` / `x2` (plain text, NOT the ½ fraction glyph — unreadable small).
  Bare +/− disappears from deck controls.
- **Alignment nudge**: plain ◀ / ▶ + the alignment accent — with every
  other pair carrying a specific icon, plain-triangle-plus-accent is
  unambiguous.
- Transition switcher ◀ name ▶ stays plain (labeled list navigation,
  different neighborhood).

## Non-goals

- Variable-tempo grid editing (deferred wholesale).
- MIDI slices 02–05 (separate feature; this PRD only keeps their seams
  stable — deck-scoped state, one beatjump size).
- New control capabilities — this is consolidation; behavior changes are
  limited to the decisions above.

## Slices

1. `01-bpm-grid-anchor-model` — backend (the ADR's implementation).
2. `02-bpm-control` — one BPM component over the new model.
3. `03-curation-cluster` — grid nudge / downbeat shared component;
   client regen ritual deleted.
4. `04-playback-cluster` — transport/cue/pads/beatjump components +
   size unification + latch.
5. `05-alignment-gestures` — accent marker, hot-cue rewire, rename.
