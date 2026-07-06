# Handoff: mix-editor issue 16 — lane node group selection

## Task

Implement `.scratch/mix-editor/issues/16-lane-node-group-selection.md`
(multi-select + group-move for breakpoints within a single automation
lane). The issue file is the spec; acceptance criteria live there.

## Context

- PRD: `.scratch/mix-editor/PRD.md` (Transition editor; re-scoped
  2026-07-03). Iteration notes: `.scratch/mix-editor/NOTES.md`.
- The lane editor lives in `frontend/src/editor/LaneCanvas.tsx`; pure
  lane/gesture logic is in `frontend/src/editor/gestureMath.ts` and
  `frontend/src/editor/mixModel.ts` (both have vitest suites — follow
  that split: pure group move/clamp/delete logic goes in a tested pure
  module, not the component).
- Issues 04 (chop stamp) and 05 (endpoint rendering) are done and
  landed — the coordination note in the issue is moot, but their
  gestures (shift chop stamp, endpoint rules) must keep working.
- The editor store landed recently (`editorStore.ts`, issue 27); check
  whether selection state belongs there. Selection state must be keyed
  by lane id (v2 = cross-lane time-shift; don't preclude it).

## Ground rules

- Set up a fresh lane per `docs/agents/parallel-work.md` (ADR 0012)
  before touching code. This is feature work: it requires human review
  before landing — run the lane app and request review per that doc.
- One jj change, described `mix-editor: 16-lane-node-group-selection`.
- Verification: tsc, eslint on touched files, vitest green; NOTES.md
  iteration entry; update the issue's Status line when done
  (`ready-for-human` with what to eye-verify).

## Suggested skills

- `implement` — primary flow for working a tracked issue
- `tdd` — for the pure lane-model logic (group move, clamp, delete)
- `codebase-design` — if the LaneCanvas/gestureMath seam needs rework
  to keep the logic testable
