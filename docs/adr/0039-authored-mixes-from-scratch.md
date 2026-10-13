# 0039 — Authoring mixes from scratch: stable slot ids, kind-fluid drafts, split persistence posture

Date: 2026-08-27
Status: accepted

## Context

#198: authoring a mix from scratch (non-session-backed) — a Routine with no
origin Take and an empty recording, traces synthesized from (entry beat,
entry position, beatmatched rate), all lanes authored. The entry-order
doctrine was already settled there (slot index = entry order per ADR 0035;
reorder = editing entry offsets). Two real decisions remained — slot identity
and persistence posture — plus the arity question ADR 0037 raises (a 2-slot
authored mix IS a Transition).

## Decisions

### Stable slot ids; index is derived

Cast slots get a **stable, client-minted `slotId`** (short uuid, the
`transition_templates` client-uuid pattern — mintable at drag-in time with no
server round-trip). Lane keys, authored Jumps, and removed-recorded-jumps key
on `slotId`, never the positional index. The entry-ordered index (slot 0 …
n−1) becomes a **derived view**, recomputed from entry offsets on every
reorder. Today's index-keyed edits (`${slot}:${control}`, `AuthoredJump.slot`)
migrate by assigning each existing slot an id — lossless, since promoted
routines never reorder (index ≡ a stable id there). Rejected: renumbering
index keys on every reorder (bulk rewrite, fragile, hostile to undo).

### Kind-fluid drafts; the count decides at persist

The blank canvas has **no artifact kind**. At persist time the cast count
decides: **2 slots → saves as a Transition** (via the ADR 0037 phase-1
translation layer, projecting slot form back to the seconds-anchored pair
artifact); **≥ 3 → saves as a Routine**. ADR 0035's boundary ("a 2-cast
routine IS a Transition") holds *at rest*; the editing surface never cares.
This **dissolves** #198's "relax n≥3 to n≥2" question — an authored 2-cast
thing is not a relaxed Routine, it simply is a Transition.

Crossings **convert on save**, both directions: a persisted authored Routine
edited down to 2 slots deletes the Routine row and mints a Transition (and
vice versa at 2→3); Set pins re-point as in Take promotion, with a notice.
Kind churn while authoring (drag track 2 → Transition minted; drag track 3 →
converted to Routine) is accepted — one delete+mint at a rare crossing, and
pins cannot exist yet on a draft being authored.

### Split persistence posture, keyed on `origin_take_id IS NULL`

- **Authored** (no origin Take): `cast` / `entry_offsets` / `positions` are
  **first-class mutable fields** with their own write endpoint(s) — they are
  the primary content; there is no recording to derive them from. Retrim is
  not overloaded: its semantic is "authored edits over an immutable
  recording", and forcing authored mixes through it would fake an empty
  recording and entangle two write paths.
- **Promoted** (origin Take exists): the baked promotion outputs stay
  immutable, **but entry offsets are editable via the edits layer** — a
  per-slot offset override in `edits_json` (keyed by slotId), for nudges and
  phrase shifts. Same idiom as an authored lane replacing a recorded lane:
  undoable, revert-to-recorded, badged as edited. Direct mutation of the
  baked field was rejected: it would be the only promoted-routine edit
  bypassing the edits layer and would silently destroy the promotion's
  testimony.
- **Trace synthesis**: `buildPlannedRoutine` synthesizes an authored slot's
  trace from (entry beat, entry position, beatmatched rate) instead of
  replaying recorded events — gated on "no origin take". The editor's
  audition and the Conductor's replay hear the same synthesized result by
  construction.

### Entry point and minting timing (reconciles #198 with ADR 0037)

#198's "'New routine' mints a Routine row with an empty cast" is superseded —
it predates ADR 0037's draft doctrine (blank drafts persist nothing until
Promote/first edit), and an empty cast is not a valid artifact of any kind.

- **Entry point**: the picker, not a separate button — a **`+ New blank
  mix`** entry (no track chips required) beside ADR 0037's two-chip
  `+ New Transition A → B` (which stays as the pair-seeded fast path).
- **Minting**: nothing persists at 0–1 slots (abandoning the draft leaves no
  trace). From **2 slots** on, normal autosave; kind follows the count with
  convert-on-save at crossings.

### Drag-to-add defaults

Dragging a track from the browse panel into the timeline appends a slot:

- **Entry position** (where in the incoming track playback starts): **Hot
  Cue 1, else track start** — the Set-playback hard-cut doctrine reused
  verbatim; one entry-anchor doctrine, not two.
- **Entry beat**: the drop point, snapped to the **downbeat** (bar) — entries
  are structural; beat-level precision is select-mode's horizontal drag
  afterward. The SNAP toggle governs (ADR 0037's ported grid-to-grid SNAP).
- **Fader lane**: an **authored closed→open step at the entry beat**, as a
  real visible/editable lane — never implicit behavior, so what you hear is
  always what the lanes say. **No synthetic exit**: the exit slot legitimately
  rides out open, and interior exits are the author's actual job.
- **Rate**: beatmatched to the routine clock (synthesized trace at the
  grid-implied rate).

## Consequences

- Reorder (select mode's vertical slot drag, ADR 0038) is safe by
  construction: identity lives in slotId; indices recompute freely.
- The `edits_json` composition gains one field (per-slot entry-offset
  override); the "edited" badge idiom extends to entries.
- The translation layer (ADR 0037 phase 1) is a hard dependency: 2-slot
  authored drafts persist *through it* as Transitions.
- Conversion at the 2↔3 boundary needs the pin-re-pointing machinery Take
  promotion already has; a notice fires when pins exist.
