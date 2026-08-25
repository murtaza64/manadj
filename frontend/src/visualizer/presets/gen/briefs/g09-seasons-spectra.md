# g09-seasons-spectra

Candidate: g09-seasons-spectra   Kind: tweak (music-driven palette swap)
Parents: g07-seasons-neon (1046) + g07-seasons-nebula (1046) — merge the
engine once, banks from both.
Human ask: palette swaps + music-driven color change.
Instruction: copy the seasons engine (keep the traveling section color
front). The season/regime is no longer a fixed genome sequence — THE
MUSIC CHOOSES: over each section, accumulate windowed spectral stats
(centroid mean, spread, flatness, energy); at the section boundary the
NEXT regime is picked by character — warm/bassy -> ember/molten bank,
bright/wide -> neon cyan/magenta, tonal/narrow -> deep celestial, noisy
-> ice/monochrome-cold (use both parents' 8 banks as the pool, tag each
with a character). Within a phrase, in-bank drift follows LIVE centroid
(slow-tracked) instead of bar clock alone. Show the decision: the
arriving front's leading rim previews the incoming bank's two purest
hues for the final bar before the cut (anticipation).
Standing law: docs/visualizer-ga.md — taste calibration, hard safety, dust fatigue, medium diversity, and the NEW FEEDBACK CONTRACTION RULE (never multiply the persistent feedback field by a sustained factor > 1; cap whole-field grades at min(x, 0.99); drama lives in the fresh-injection term bounded by (1-decay); constant additive terms need envelopes or (1-decay) normalization). Focus (human, gen-9): palette swaps, music-driven color change, spectrally-informed palettes. Shared spectral-color vocabulary for this generation: hue center from slow-tracked centroid (~1s EMA), hue span from spread, saturation from (1 - flatness); quantized/regime uses of these must change on musical boundaries, not per-frame flicker. Phrase/section tiers via `beat.ladderBarIndex ?? beat.barIndex`.
File: g09-seasons-spectra.candidate.ts.
