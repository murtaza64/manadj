# g09-hardcut-listen

Candidate: g09-hardcut-listen   Kind: tweak (music-driven palette swap)
Parents: g07-voyage-hardcut (1060, 4/0-class winner; raid g08-hardcut-
beat's accent-flip if useful).
Human ask: music-driven color change; palette swaps.
Instruction: copy voyage-hardcut; the phrase look's PALETTE BANK is no
longer genome-sequenced — the music picks it: quantize the PREVIOUS
phrase's windowed spectral stats (centroid tercile x flatness half) into
a bank index over an expanded 6-bank set (add one green/teal and one
violet bank alongside the parent's four; all obey mean-luminance
parity). Same song section played twice = same colors (deterministic
from audio character, not randomness). Arm count / effect-set cuts stay
genome-driven (structure vs color separation). Keep the anticipation
tick + drop-on-boundary slam; contraction rule applies.
Standing law: docs/visualizer-ga.md — taste calibration, hard safety, dust fatigue, medium diversity, and the NEW FEEDBACK CONTRACTION RULE (never multiply the persistent feedback field by a sustained factor > 1; cap whole-field grades at min(x, 0.99); drama lives in the fresh-injection term bounded by (1-decay); constant additive terms need envelopes or (1-decay) normalization). Focus (human, gen-9): palette swaps, music-driven color change, spectrally-informed palettes. Shared spectral-color vocabulary for this generation: hue center from slow-tracked centroid (~1s EMA), hue span from spread, saturation from (1 - flatness); quantized/regime uses of these must change on musical boundaries, not per-frame flicker. Phrase/section tiers via `beat.ladderBarIndex ?? beat.barIndex`.
File: g09-hardcut-listen.candidate.ts.
