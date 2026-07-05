# 03 — Pure planner + overview ladder

Status: ready-for-human

## Parent

.scratch/sets/PRD.md

## What to build

The pure planner module — the feature's single new test seam: `plan(set, pins, track facts) → deterministic playback plan`. Per entry: deck (ping-pong parity), entry/exit in track time, outgoing window, incoming overlap, mix-time offset; hard cuts for unresolved adjacencies (outgoing to end, incoming from Main cue; first track starts at Main cue). Take pins plan through the existing vectorizer (idealized Transition computed at plan time, never snapshotted). All Set-playback semantics live here; test exhaustively in the mold of the mix-model/vectorizer suites.

On top of the planner: the **overview ladder** from the prototype verdict (variant D — see NOTES.md next to the prototype in the sets lane; reimplement fresh, do not promote prototype code). Zoomed staircase minimap above the Set list: mirrored deck lanes around a center line (A grows up, B hangs down), title strips outside the waveform on the outer edge, hot cues (faint line + triangle) on the title side, transition/take bands, hard cuts as dashed red blade + ✕. Ladder and list scrolls pinned to one progress value (list scroll fraction ↔ ladder scroll fraction — pure centering fails at the edges). Per-row "plays m:ss of m:ss"; set length in the toolbar.

## Acceptance criteria

- [ ] Planner is pure, side-effect free, and covered: parity, windows, mix offsets, hard cuts, Main-cue starts, take vectorization delegation
- [ ] Ladder renders all pin states distinctly; hard cuts unmissable
- [ ] Ladder/list scrolls stay pinned; list top ⇒ set start flush left, list bottom ⇒ set end flush right
- [ ] Per-row played durations and total set length agree with the plan

## Blocked by

- 02-adjacency-pins-evidence

## Comments

**2026-07-05 — Implemented (change vykmvyym, parked for review).**
`sets/planner.ts` is the pure seam: `planSet(entries, tracks,
transitionsByUuid, takesByUuid) → SetPlan` (per entry: deck parity,
entry/exit in track + mix time, native-rate mix anchor; per adjacency:
kind, executed Transition, window mix span, tempo-match rate). Take pins
vectorize at plan time via `capture/vectorize`; dangling/unvectorizable
pins degrade to hard cuts; jumps fold into the incoming anchor via
`bTrackTimeAt`/`bContentSegments`; overlap + past-end windows warn.
16 tests in `planner.test.ts`. `useSetPlan` assembles inputs (pair store,
`['take', uuid]` queries, track map); `OverviewLadder.tsx` is the variant-D
ladder reimplemented fresh (ZOOM=5, mirrored lanes, outer-edge titles,
real hot cues line+triangle on the title side, transition/take bands,
dashed-red-✕ hard cuts, one-progress-value scroll pinning; click scrolls
the list — click-to-seek is issue 05). SetDetailPane: ladder above the
list, per-row "plays m:ss of m:ss", set length in the toolbar, deck-color
row accents.

**2026-07-05 — Review walkthrough (ready-for-human).** Lane app at
**http://localhost:5253** (backend 8080, sandbox DB). The sandbox's
"test set" is seeded with 8 tracks: 2 Transition pins, 3 Take pins, 2
unresolved tails. Clicks:

1. Library mode → sidebar **Sets** → "test set". Above the list: the
   zoomed staircase ladder — A clips up top, B hanging below the center
   line, titles on the outer edges, hot-cue lines+triangles on the title
   side, green Transition bands / orange Take bands, dashed red ✕ blades
   at the two hard cuts (after "Stutter" and "Calling For A Sign").
2. Scroll the list: the ladder follows (top ⇒ set start flush left,
   bottom ⇒ set end flush right); off-screen clips dim. Click a far part
   of the ladder: the list scrolls there.
3. Rows: "plays m:ss of m:ss" per track (first track starts at its Main
   cue; hard-cut outgoings play to their end), deck-colored left borders,
   toolbar shows "8 tracks · <set length>".
4. Re-pin an adjacency (pin chip) → ladder + durations recompute live.
