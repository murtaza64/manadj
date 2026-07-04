# BPM is a projection of the Beatgrid

Status: accepted (grill 2026-07-04)

When a Beatgrid exists it is the authority on tempo. A Track's BPM value —
in the tag editor, deck cards, sync comparisons, ID3/Engine export — is a
projection of the grid (its dominant tempo), not an independent field.
Without a grid, BPM is plain metadata: a seed from the source (ID3,
SoundCloud) whose only tempo job is to parameterize placeholder-grid
generation.

Consequently, "editing BPM" is a grid operation, executed server-side by
the BPM write path (one owner, atomic — replacing three divergent client
copies of the PATCH→delete-grid→regenerate ritual, only one of which was
serialized against interleaving). Its meaning switches on the grid's
origin:

- **generated** (placeholder — "not saved info" per the glossary):
  regenerate freely from the new value.
- **edited / imported** (saved info): **anchor-preserving re-tempo** —
  respace beats around the grid's anchor; never delete-and-regenerate.
- **variable grid** (multiple tempo changes): a single-BPM edit is not
  meaningful and is not offered; the readout shows `~N (var)`.
  (A "flatten to constant" verb was considered and deferred — no story
  wants it yet.)

**The anchor is the downbeat the user explicitly marked**, persisted on
the grid (`anchor_time`). Today's set-downbeat extrapolates back to t≈0
and discards the marked time — a later re-tempo would scale from a
synthetic first beat and drift the user's known-good downbeat, error
growing with distance. Instead: set-downbeat records the mark (last
explicit mark wins) and rebuilds the grid through it; re-tempo respaces
around it; a grid nudge shifts the anchor along with everything ("it's
all off by 10ms"); grids without a mark fall back to the first downbeat.
Set-downbeat on a variable grid re-anchors by shifting the tempo-change
map — replacing today's silent flatten to a single tempo change.

## Considered options

- **BPM and Beatgrid as independent fields** (status quo) — rejected: it
  makes "edit BPM on a gridded track" ambiguous (today it silently
  discards downbeat edits via delete+regen), lets track BPM and grid
  tempo disagree with no arbiter, and forces every UI surface to
  re-implement the reconciliation ritual.
- **Client-side shared hook for the regen ritual** — rejected: fixes the
  duplication but leaves the invariant ("grid follows BPM") living in
  whichever clients remember to use it; the server owns the data
  (ADR 0001), so it owns the invariant.
- **Grid-first with BPM as a stored denormalization** — accepted in
  effect: `tracks.bpm` may remain as a cache for query/sort paths, but
  writes flow through the grid operation and reads treat the grid as
  truth when present.

## Consequences

- Scenario coverage: (1) downloaded track with a BPM tag → seed →
  placeholder regen on BPM edits until the first grid edit, after which
  BPM edits re-tempo around the anchor; (2) Engine grid import → grid
  authoritative, BPM display follows it; (3) accepting an Analysis BPM
  regenerates only placeholder grids — against an edited grid it warns.
- Sync: a BPM divergence when both sides have grids is a grid divergence
  seen twice — the sync view should derive BPM's cell from the grid
  comparison in that case, and treat BPM as its own field only for
  gridless tracks (performance-data-sync follow-up).
- Audit: every writer of `tracks.bpm` (tag editor, deck cards, analysis
  accept, sync import, bulk import) must route through the grid
  operation. Implementation: `.scratch/deck-controls/issues/01`.
