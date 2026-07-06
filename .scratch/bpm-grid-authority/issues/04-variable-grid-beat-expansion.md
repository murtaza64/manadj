# 04 — Variable-grid beat expansion walks all segments

Status: ready-for-agent
Type: task

ADR 0027 §4. `calculate_beats_from_tempo_changes`
(`backend/beatgrid_utils.py:20-27`, "use only first tempo change for
now") serves every beatgrid response — on a multi-tempo grid (Engine
import), every beat after the second tempo change is wrong with linearly
growing error, and client-side Quantize (looping 01) snaps to phantom
beats.

## Change

- Walk all segments: within each tempo change, beats at that segment's
  interval from its `start_time`; carry beat/bar phase across
  boundaries so downbeats stay consistent with `bar_position`.
- Mirror in `_downbeat_times` (`beatgrid_utils.py:164-169`) — keep the
  two derivations producing identical floats for shared beats (the
  waveform downbeat matching relies on exact equality until issue 08's
  epsilon lands; safest is deriving downbeats FROM the beat expansion).
- `dominant_bpm` already walks segments — untouched.
- Doctrine (no code): tempo-domain features stay dominant-BPM; this
  issue only makes stored data serve true beats.

## Testing decisions

- Two-tempo fixture (e.g. 120 → 150 at t=60): beat spacing correct in
  both sections; boundary beat placed once; downbeat_times ⊂ beat_times
  bit-identically; bar phase continuous.
- Constant-grid outputs byte-identical to today (regression).
