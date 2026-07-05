# Handoff: implement the looping feature

Source session: grilling + PRD + issue breakdown for looping/Quantize (2026-07-05).

## State

- Design is fully settled — no open questions. Glossary entries landed in `CONTEXT.md` this session: **Quantize**, **Active loop**, **Saved loop** (planned stub), amended **Jump event** (repeat count), amended **Take** (loop collapse on promotion), "loops" added to the Audible surface gesture-class list.
- PRD: `.scratch/looping/PRD.md` (`ready-for-agent`) — problem, decisions, testing seams, out-of-scope.
- Issues: `.scratch/looping/issues/01`–`06`, all `ready-for-agent`, dependency graph: 01 → {02, 03}; 03 → {04, 05, 06}.

## Task

Work through the issues in dependency order, starting with `01-quantize-toggle-placement-snapping.md`. One jj change per issue, description `looping: <issue-file-stem>` (house style, AGENTS.md). Nothing is implemented yet.

## Code pointers (exploration findings; verify before relying on them)

- Transport reducer (primary seam): `frontend/src/playback/transport.ts` (+ `transport.test.ts`)
- Worklet source kernel (sample-accurate wrap): `frontend/src/playback/worklet/deckSourceKernel.ts` (+ test); engine playhead anchor math in `frontend/src/playback/DeckEngine.ts` (~lines 100, 424, 553)
- Backend unconditional hot-cue snap to remove: `quantize_to_nearest_beat` in `backend/crud.py` (~787), used by `set_hotcue`; Engine import bypass at `backend/sync_performance/apply.py`
- UI: `frontend/src/components/deckControls/BeatjumpRow.tsx` (idiom for LoopRow), `performance/DeckPanel.tsx` PlayZone, `components/Player.tsx` overlay, `components/TopBar.tsx` (Q toggle), keys in `performance/performanceKeys.ts` + `hooks/useKeyboardShortcuts.ts`
- Waveform overlay pass (shaded-region primitive goes here): `frontend/src/waveform/WaveformRendererV2.ts` (~706–950)
- Capture vectorizer (issue 06): `frontend/src/capture/vectorize.ts` (+ test)
- MIDI gesture classes: `frontend/src/midi/dispatch.ts` (ADR 0019); relevant ADRs: 0007–0009, 0013, 0016–0020

## Verification

- Frontend: `npm test` in `frontend/` (vitest)
- Backend: `uv run -m pytest tests`

## Suggested skills

- `implement` (primary driver, works from the issues)
- `tdd` for the reducer/kernel slices — the PRD's testing seams are pure and red-green friendly
- `codebase-design` if a seam decision comes up mid-implementation
