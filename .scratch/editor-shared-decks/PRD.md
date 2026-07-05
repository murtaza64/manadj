# PRD: Transition editor on the shared Decks/Mixer

Feature slug: `editor-shared-decks`
Grill: 2026-07-05. Decision record: ADR 0022 (supersedes 0021, parts of
0013; restores 0009). Handoff origin: fold the editor's private Mixer
(`MixPlayer`) onto the shared two Decks + one Mixer/AudioContext.

## Problem

The Transition editor owns a private Mixer + engine pair, against ADR
0009's one-context intent. Every mixer/deck feature must land twice or
carve the editor out; three shipped bugs trace to it (two-clock stutter →
the arbiter, hardware addressability → ADR 0019 carve-outs, device
routing miss → ADR 0021's interim registry).

## Decision summary (details in ADR 0022)

1. Full unification: `MixPlayer` becomes a pure conductor over injected
   shared engines + Mixer; owns no audio machinery.
2. Mixer **automation overlay**, replacement semantics, for the 10
   lane-driven controls (fader/EQ/filter ×2); base state never mutated;
   Mixer reapplies base on release. Crossfader **pinned neutral** while
   the editor is audible. Trim/master/cue/PFL pass through live.
3. Borrowed-deck **pitch checkpoint** (save on claim, restore on
   release); transport mutations persist. Pitch-range clamping moves to
   callers (±8% performance, ±25% editor). Key Lock carve-out retired —
   the editor plays through each Deck's sticky Key Lock.
4. **Capture gates on audibility**: recorder runs only while 'shared'
   holds the surface; in-flight engagement discarded on loss.
5. **Arbiter shrinks**: `silence()` = pause only; `wake()`-as-resume and
   the `mayStart` tripwire deleted. Gesture-class routing (ADR 0019)
   unchanged.
6. **Load mirroring dies**: editor loads are Deck loads through the one
   DeckContext load path.
7. No feature flag; risky pieces land first, consumer-free, under tests.

## Wins to verify at the end

- Master AND cue/PFL routing just work in the editor (headphone cueing in
  the editor is new capability).
- Key Lock during tempo-matched auditions (key-lock issue 05 resolved).
- ADR 0021 registry deleted; second AudioContext/engine pair/worklets/
  limiter chain gone; wake-lock and future mixer features cover the
  editor for free.

## Slices

1. Mixer automation overlay (no consumer; vitest at the Mixer seam)
2. Capture gate on audibility (vacuous today, load-bearing after swap)
3. Prefactor: invert MixPlayer's ownership (inject, zero behavior change)
4. The swap (editor conducts the shared machinery; deletions ride along)
5. Cleanup + docs (ADR 0021 registry, dead Mixer suspend/resume, comments)

Ordering constraint: `mayStart` dies IN the swap, not before — until the
private mixer is gone it still guards the two-clock bug.

## Risks

- Swap slice is the big one even after the prefactor: editor, arbiter,
  engines, DeckContext in one land. Everything it depends on lands green
  first.
- Overlay lifecycle (engage/disengage) and checkpoint/restore are
  StrictMode-sensitive territory — effects pair setup/cleanup; regression
  history in headphone-cue 06.
- The swap's real gate includes an **ear check**: release-reapply pops,
  overlay writes vs `rampGain`'s cancel-then-anchor, stretch artifacts at
  ±25%, PFL-in-editor, return-to-Performance state.
- Audible behavior merges (accepted in the grill): cue-default parking on
  editor loads, Key Lock ON sound, live trim/master during auditions.
- With `mayStart` gone, any direct engine start outside arbiter routing
  while the editor is audible would double-drive the decks — audit known
  callers in the swap slice.

## Out of scope

- Trim state in the Transition editor (filed as issue 01, needs-triage).
- Third audible surface / claim-stack semantics (re-grill per ADR 0013).
- Any Take/Handover detection changes beyond the audibility gate.

## Process

Repo conventions: jj, one change per issue, description
`editor-shared-decks: <issue-file-stem>`; gate = pytest + vitest +
frontend build + single alembic head. Claims: `frontend/src/editor/**`,
`frontend/src/playback/**`, `frontend/src/contexts/DeckContext.tsx`,
`frontend/src/capture/**` — check `.lanes/` before starting (all relevant
lanes idle at grill time).
