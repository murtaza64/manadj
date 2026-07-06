# 41 — Rows batch (31/32/35/33) follow-up polish

Status: needs-triage

## Parent

.scratch/sets/PRD.md (filed at the rows batch landing, 2026-07-06 —
known polish deferred out of the batch, none blocking)

## Items

Visual / interaction:

- **Transport centering at narrow widths** (22 follow-up, `pmqwsspo`):
  the viewport-centering shift is a paint-only transform — at extreme
  narrow widths the transport can visually overlap the header's left
  zone instead of reflowing. A layout-true version would size the grid's
  side columns asymmetrically off the measured offset.
- **Selected+loaded rows** (35): identity wash + blue ring, no blue
  wash (the conducting-wash precedent). Approved as-is at review;
  revisit if selection legibility suffers on washed rows in practice.
- **Adjacency rows are 12px, track rows now 13px** (31 iteration): the
  overlap-time cell matches the 13px time band, the chips stay 12px.
  Deliberate (secondary rows) but unreviewed as a pair.
- **perf-layout 08 adoption**: two flagged vocabulary edges — the
  mark-yields-to-hover idiom (playing bars → ▶ on hover) and `scaleY`
  state animation vs the "no scale effects" rule (read as governing
  interaction feedback only). Adopt into the vocabulary or correct the
  rows. (Comments already on 08.)

Code health:

- **`fixedTempoRef` restates the planner's fallback** (31): the Fixed
  BPM-delta reference re-derives "set tempo, else first track's
  effective BPM" because the planner doesn't export its resolved tempo
  and planner.ts was lane-contested (24). Export it from `planSet`
  output instead once the setlist lane is quiet.
- **`--peach` value duplicated** in `bpmDeltaColor` (`#ff9500` — the
  var is scoped to `.set-header`; unscoping trips the two dormant
  pre-08 box-shadow glows per the SetDetailPane.css note). Untangle the
  token scoping.
- **Energy circle rule** (31 iteration): SetDetailPane.css re-states
  the library's circle idiom via `--energy-color` (one rule);
  TrackRow.css still carries five per-level copies predating that
  property. Fold both into an EnergySquare variant.

Input parity:

- **Set pane keyboard row navigation** (33): the encoder walk has no
  keyboard twin — arrow keys don't move the Set row selection. Add
  arrow-key navigation reusing the same `navigate` rule (closes the
  Controller-glossary "no new capabilities" gap properly).

## Blocked by

- (none — items are independent; the planner export waits on the
  setlist lane going idle)
