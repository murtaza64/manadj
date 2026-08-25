# g09-hypno-glide

Candidate: g09-hypno-glide   Kind: tweak (note fix + spectral colors)
Parents: g08-hypno-pulse (1016) + g08-hypno-eq (2 apr).
Human note (verbatim, on both): "both are still awkwardly jittering,
motion doesnt feel smooth".
Instruction: copy g08-hypno-pulse; (1) MOTION FIX — the jitter comes
from driving rotation phase off the beat feed (beat.phase jumps with
feed latency/deck nudges). Integrate rotation in JS: constant angular
velocity from a SMOOTHED bpm (τ~2s), never sampling beat phase into the
clock; bar-rational speed still (velocity = rational multiple of
smoothed bpm); ease any residual corrections over ≥250ms. Verify: no
per-frame phase discontinuities anywhere (grep your own math). (2) Keep
the liked grammar: bar-stepped palette pairs, A/B chroma swap on beat
(driven by a beat-edge DETECTOR that fires the swap, not by phase-
locking the clock), kick twist surge with elastic recovery, energy->
glow. (3) SPECTRAL COLORS: band-A hue from slow centroid, band-B =
complement; pair saturation from (1 - flatness); bar steps offset from
this spectral base rather than a fixed sequence.
Standing law: docs/visualizer-ga.md — taste calibration, hard safety, dust fatigue, medium diversity, and the NEW FEEDBACK CONTRACTION RULE (never multiply the persistent feedback field by a sustained factor > 1; cap whole-field grades at min(x, 0.99); drama lives in the fresh-injection term bounded by (1-decay); constant additive terms need envelopes or (1-decay) normalization). Focus (human, gen-9): palette swaps, music-driven color change, spectrally-informed palettes. Shared spectral-color vocabulary for this generation: hue center from slow-tracked centroid (~1s EMA), hue span from spread, saturation from (1 - flatness); quantized/regime uses of these must change on musical boundaries, not per-frame flicker. Phrase/section tiers via `beat.ladderBarIndex ?? beat.barIndex`.
File: g09-hypno-glide.candidate.ts.
