# 08 — BUG: drift-corrector artifacts on some pairs (playhead stutter + ~0.5s clicks)

Status: needs-info (repro pending)

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
