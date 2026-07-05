# 06 — Tempo policies: Riding and Fixed

Status: done (landed on main, change oxwwnsvl)

## Parent

.scratch/sets/PRD.md

## What to build

Per-Set Tempo policy. **Riding**: after each window closes, the incoming Track eases from its matched rate back to native — the Tempo return, a tunable-heuristic ramp that must complete before the next window; the planner emits insufficient-runway flags (clamp faster rather than stay incomplete) and the ladder/toolbar surface them. **Fixed**: an explicit, editable Set tempo (BPM, defaulted from the first Track's native BPM); every Track pitched to it; pinned Transitions play rate-scaled as a whole (tempo-matched Transitions scale cleanly under a global rate; the tempo-match flag is moot). Toolbar chip shows the policy (and Set tempo when Fixed). Key Lock: the Conductor inherits each Deck's sticky setting; no Set-level override.

## Acceptance criteria

- [ ] Planner covers both policies: ramp segments + runway flags (Riding), global rate scaling (Fixed)
- [ ] Riding: audible ramp back to native between handovers; next Transition plays as authored
- [ ] Fixed: whole Set holds the Set tempo; changing it re-plans; default comes from the first Track
- [ ] Runway warnings visible on the affected adjacency in the Set view
- [ ] Policy and Set tempo persist per Set

## Blocked by

- 04-conductor-v1

## Comments

**2026-07-05 — Implemented (change oxwwnsvl).** All semantics in the
planner seam, tested there (12 new planner tests):

- `PlanInput.tempo`: `{policy:'riding', returnSecPerPercent?}` |
  `{policy:'fixed', setTempoBpm}` (null tempo → first track's BPM).
- **Riding**: after each window the incoming eases from the matched rate
  back to native — `PlannedAdjacency.tempoReturnEndSec` marks the ramp
  end; rate eases linearly so track time is quadratic through the ramp
  (`planStateAt` evaluates position + decaying pitch). The ramp must
  complete before the incoming's next boundary (next window start, else
  its end): `dMax = 2(nextBoundary − bAtWindowEnd)/(1+rateB)` clamps it
  to end exactly AT the next window (clamp-faster), emitting an
  `insufficient-runway` flag. Ramp speed is a tunable setting
  (`sets/setSettings.ts`, localStorage, default 2 s/% — no editing UI
  yet; PRD: settings, not model).
- **Fixed**: every entry gets a constant deck rate `setTempo/bpm`
  (clamped ±25% with a `pitch-clamped` flag; BPM-less tracks play native
  with a `no-bpm` flag). Windows play rate-scaled as a whole: the plan
  carries `rateOutgoing`, mapping global mix time onto the authored
  window axis (`authoredLocalAt`) for lanes/jumps/B-position; B advances
  at rateIn/rateOut per authored second — tempo-matched by construction,
  the flag is moot. Changing the Set tempo re-plans (query invalidation →
  `useSetPlan` deps).
- **Warnings restructured**: `PlanWarning { severity, kind, message,
  adjacencyIndex?, entryIndex? }` replaces the old strings — surfaced on
  the affected adjacency row (chips), the toolbar (⚠ count), and the
  ladder (⚠ markers at the window; magenta strips draw the Tempo
  returns).
- **Persistence**: `sets.tempo_policy` + `sets.set_tempo_bpm` (migration
  `0021_oxwwnsvl`, sandbox-only until landing); PATCH round-trip tested
  at the router seam. Toolbar chip shows the policy (popover switches it;
  Fixed seeds the tempo from the first track and keeps it editable).
- **Key Lock**: nothing added — the Conductor already inherits each
  Deck's sticky setting (keyLockStore via DeckContext); flips remain
  takeover triggers.
- Conductor needed NO changes: pitch/rates flow entirely through
  `planStateAt` (per-tick `setPitch`).

**2026-07-05 — Review walkthrough (ready-for-human).** Lane app at
**http://localhost:5253** ("test set", 8 tracks). Script:

1. Toolbar shows a **Riding** chip. Play the set through a tempo-matched
   transition (adjacency with a ◆ pin between BPM-mismatched tracks):
   after the window the incoming's pitch eases back to 0 (deck pitch
   readout) instead of snapping; a magenta strip after the window in the
   ladder marks the return.
2. Click the chip → **Fixed**. It seeds the Set tempo from track 1's BPM;
   the whole ladder re-lays out (solo stretches stretch/shrink by each
   track's rate). Deck pitch now holds constant per track while playing —
   every track at the Set tempo.
3. Edit the BPM in the chip popover (e.g. ±10): the plan recomputes live
   (row "plays m:ss" durations + ladder change), and warning chips appear
   if a track needs >±25% (pitch clamped) or has no BPM.
4. Back to Riding: if any solo stretch is too short for the ramp, the
   affected adjacency row shows "⚠ tempo runway", the toolbar counts it,
   and the ladder marks ⚠ at that window.
5. Seek around (ladder clicks) — mid-window, mid-ramp, and solo positions
   all land decks/pitch consistently under both policies.

**2026-07-05 — Approved and landed.** Human approval ("land these");
gate green on the landed tree (651 pytest, 944 vitest, build + tsc
clean, single alembic head 0021_oxwwnsvl). main → pkwxstws (06+14
together).
