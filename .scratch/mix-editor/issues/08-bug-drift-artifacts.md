# 08 — BUG: drift-corrector artifacts on some pairs (playhead stutter + ~0.5s clicks)

Status: done (2026-07-03 — root-caused from protoperf log, fixed; user verification pending)

## Symptom

In the Transition editor, on certain track pairs (repro: Weeble Wobble +
Never Alone; NOT Weeble Wobble + Last Time), playback has audio artifacts
every ~0.5s and the playhead visibly jumps forward. Unloading and reloading
the affected track (Never Alone) made it stop — load-order/state dependent,
not steady clock drift.

## Context / leads

- Artifacts every ~0.5s at 0.12s drift tolerance ≈ a ~24% rate error —
  suspicious of the tempo-match path (the good pair likely needs ~0% pitch,
  the bad pair a real stretch).
- Ruled out statically: engine vs `tempoMatchPitch` clamp mismatch (both
  ±8%), `setRateComponents` anchor math (correct: re-anchors at old rate,
  live `playbackRate.setValueAtTime`), arrangement math (rateB used
  consistently by `arrangementAt` and `applyPitch`).
- Fixed-by-reload hints at load ordering: grid-first `setBpm` effect racing
  the initial adopt/load, or stale `durations` from a superseded load.
- Appeared after the v11 stack merge (MixProtoPlayer moved onto the merged
  DeckEngine + private Mixer) — possibly a merge regression; user notes it
  resembles earlier playback problems in other modes.

## Repro instructions (when it recurs)

Open the editor with `&protoperf`, load a bad pair, play through the
transition, capture the `[protoperf]` console lines. Instrumentation already
in `MixProtoPlayer.syncDeck` logs every corrective action (deactivate /
restart / drift reseek) with engine playhead, pitch, rateB, bpms, durations,
loadState, playing/pendingPlay. The log discriminates: growing drift on B
(rate mismatch) vs restart spam (activity flapping) vs `dur=…/0.0` (load
race) vs `pitch=0, rateB≠1` (pitch never applied).

## Blocked by

None — needs a reproduction.

## Root cause (from the protoperf log)

The engine playhead read back at `target + previous drift` after every
re-seek — mirror-image overshoot (−0.147 → +0.153 → …, even −1.32 → +1.33).
Decoding the deltas: audio-clock elapsed vs wall-clock elapsed between logs
was 0.174s vs 0.021s, then 0.058s vs 0.215s — `ctx.currentTime` freezing and
leaping relative to `performance.now()`. The engines were honest; the mix
timeline ran on a DIFFERENT clock (wall time), and the drift corrector
translated clock skew into audible re-seeks.

Why it appeared: issue 07's load mirroring spins up the shared Mixer's
AudioContext alongside the editor's private one; with two live contexts the
context clocks stutter under device contention. Pair-dependence was a red
herring (timing-sensitive, load-order dependent). Same disease class that
motivated ADR 0009's one-graph rule.

## Fix

1. Single time base: `MixProtoPlayer`'s mix timeline anchors to its own
   Mixer's `ctx.currentTime` (`Mixer.now()`), the same clock the deck
   playheads derive from — drift ≈ 0 by construction; the corrector stays as
   a rare safety net.
2. One running context at a time: the editor suspends the shared Mixer's
   context while mounted (`Mixer.suspend()/resume()`; loads/decodes still
   work suspended, deck play resumes on demand).

Instrumentation left in place (inert without `?protoperf`) to verify the fix
on the bad pair; strip when issue 08 is verified.
