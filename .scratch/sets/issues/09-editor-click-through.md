# 09 — Adjacency click-through to the Transition editor

Status: done — approved and landed 2026-07-05

## Parent

.scratch/sets/PRD.md

## What to build

Clicking an adjacency in the Set view loads the pair onto the Decks (outgoing→A, incoming→B — the editor always presents outgoing-as-A regardless of Conductor parity) and switches the top panel to the Transition editor: a Transition pin opens with that Transition selected; a Take pin opens the existing Take-review flow; unresolved opens a blank sketch for the pair (the rehearsal to-do click-through). The browse surface below does not remount or move — the Set view is still there under the editor, so walking a set's handovers (tune adjacency 3, click adjacency 4) stays inside editor mode. Clicking while the Conductor plays stops it (mode switch; editor entry pauses shared playback via the audible-surface arbiter).

## Acceptance criteria

- [ ] Transition pin → editor on that pair with the pinned Transition selected
- [ ] Take pin → Take review for that Take
- [ ] Unresolved → blank sketch for the pair
- [ ] Set pane below the editor keeps its scroll/selection; clicking another adjacency swaps the editor pair without leaving the mode
- [ ] Edits to a pinned Transition reflect in the Set plan on return (no stale plan)

## Blocked by

- 02-adjacency-pins-evidence

## Comments

**2026-07-05 (agent, lane setui) — implemented, parked for review** (jj change `pqmwzoxy`)

Mechanism: adjacency rows are now clickable (whole row; the pin chip / auto-fill / + insert buttons stop propagation). Routing uses the RESOLVED pin (`adjacencyView`, so dangling pins go the unresolved path): Transition pin → `requestPairEdit` with the uuid; Take pin → the existing `requestTakeReview` flow; unresolved → `requestPairEdit` with null → blank sketch. `editor/openPair.ts` is a one-shot pending + CustomEvent handoff (the takeReview.ts pattern); App flips the mode; the mounted editor consumes the request, assigns outgoing→A / incoming→B (`assignTrack` — shared-deck loads, ADR 0022), `loadPair`s, then `selectTransition(uuid)` or `startBlankSketch()` (new emit-only EditorStore method — opening an adjacency is not an edit; the pristine sketch never persists). `openPair` re-claims the editor's audible surface, so a Conductor started from the Set pane under a mounted editor stands down on the next adjacency click.

Verification: gate green (pytest 636, vitest 920 across 59 files incl. new openPair + startBlankSketch tests, tsc+vite build, alembic single head; no backend/python files touched).

**Verification walkthrough** — lane app running at http://localhost:5313 (desktop shell: `npm --prefix /Users/murtaza/manadj/desktop start -- --port 5313`):

1. Library mode → select a Set in the sidebar. Scroll the Set pane somewhere non-trivial; note the scroll position.
2. Click an adjacency row with a green ◆ Transition pin → Transition editor opens, outgoing on A / incoming on B, that Transition selected in the switcher.
3. In the editor's bottom browse panel the Set pane is still there, at the same scroll. Click a different adjacency (mauve ● Take pin) → Take review opens for that Take (still in editor mode).
4. Click an unresolved (✕ hard cut) adjacency → blank sketch ("Transition N", default shape) on that pair.
5. Press ▶ Play set in the Set pane's header (under the editor), then click any adjacency → the Conductor stops (mode-switch semantics), pair loads.
6. Stale-plan check: from the Set view click a pinned adjacency, drag its window/lanes in the editor, return to library mode → the ladder/row durations reflect the edit.

**2026-07-05 (agent, lane setui) — approved and landed** (`pqmwzoxy` on main, human verbal approval in-session).
