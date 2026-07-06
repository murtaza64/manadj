# Handoff: sets — rows batch: issues 31 → 32 → 35 → 33

## Task

Implement, in order (each builds on or shares the previous's territory):

1. `.scratch/sets/issues/31-set-row-columns.md` — columnar row grid, BPM/key left + color-coded (triage decisions in its Comments: key = Camelot-hue identity, BPM = delta vs Set tempo [Fixed] / predecessor [Riding]), time columns, shared column constants
2. `.scratch/sets/issues/32-adjacency-overlap-time.md` — overlap time in the shared time-column band (hard cuts BLANK, per Comments)
3. `.scratch/sets/issues/35-loaded-playing-row-indication.md` — per-deck loaded highlights (LIVE deck occupancy, not plan parity) + deck-neutral animated playing indicator; replaces the single active-row highlight
4. `.scratch/sets/issues/33-controller-browse-load-set-mode.md` — controller browse encoder walks rows (skipping adjacencies) via 18's selection model; LOAD A/B through the embedding view's load policy

Gate + `code-review` per issue; **park each ready-for-human** with walkthroughs printed in your output (31/32/35 are visual — expect iteration; 33's walkthrough needs the physical controller, note that for the human). One jj change per issue. Stop after 33 parks.

## Process — ADR 0026

Feature work parks ready-for-human; merge-based landing (docs/agents/parallel-work.md); default workspace read-only; set `owner: <session id>` in `.lanes/setui.md`.

## Workspace — handed over (idle lane setui)

- Workspace: `/Users/murtaza/manadj-setui` — this lane built the rows bundle (23/18/20) and 22's vocabulary alignment; the row DOM is its own recent work. `jj new main` first; re-clone sandbox DB if stale.
- Ports: +130 (backend 8130, vite 5303)

## Context pointers

- 31 kills the hand-derived `GUTTER_WIDTH` math from 20 — shared column constants consumed by SetTrackRow AND AdjacencyRow; 32 aligns to them.
- 35's glossary constraint: deck colors are identity only (loaded-on-A/B), the playing animation is a STATE mark and stays deck-neutral. Occupancy/transport read from DeckContext/engines — view-only, no store changes. Verify divergence case (takeover + manual load → highlight follows reality).
- 33: extend the library list's existing controller browse-target contract (see how `Library browseOnly` registers it) — do not invent a parallel one. Encoder select ≡ click select for 17's menu and 18's ops.
- All row states must coexist: selection (18), hover vocabulary (22/perf-layout 08), badges (UNPRACTICED, NEVER AUDIBLE), 35's new marks.
- perf-layout 08 vocabulary applies to anything you touch; a base-class gap = comment on that issue, don't fork.

## PARALLEL LANE STATE

- `setlist` is running 24 (live re-plan; Conductor/planner) — not your files; plan-shape types you consume (`PlannedEntry.entryMixSec` etc.) could shift if it lands mid-batch: re-gate on merge.
- `looping` lane running the cue-quantize fix (backend beatgrid) — disjoint.
- Issue 34 (transport input routing) is queued for AFTER 24 elsewhere — its keyboard/MIDI dispatch work may graze 33's midi routing; you land first, they rebase.

## Gate

`uv run -m pytest`; `npm --prefix frontend run build`; `npx vitest run`; `uv run alembic heads` → one (no migrations); lint on touched files.

## Suggested skills

- `implement`, `tdd` (column constants + color-scale logic are pure-testable), `code-review` before parking

## Out of scope

Issues 24/26/28/34; ladder internals (30 parked on setsugg); planner/Conductor; adjacency drag/pin behavior.
