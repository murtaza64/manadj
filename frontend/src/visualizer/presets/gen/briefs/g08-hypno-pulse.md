# g08-hypno-pulse

Candidate: g08-hypno-pulse   Kind: tweak (note-driven)
Parents: g07-hypno (1017, 1/0, 2 apr).
Human note (verbatim): "changing speed based on energy is jarring, keep
speed relatively consistent and modulate some other param with energy
(maybe glow?) or smoothed i like the phase changes, maybe add palette
changes as a more frequent bpm-aligned movement? and maybe color
switching (a<->b) on beat?"
Instruction: copy g07-hypno; (1) rotation speed CONSTANT per family
(bar-rational, no energy modulation — drop no longer speeds up);
(2) energy/drop now drives GLOW: band bloom + edge luminosity ride
max(drop, energy), smoothed; (3) palette pair STEPS to a new pair every
bar (bpm-aligned, hard step, genome sequence); (4) the two band colors
SWAP (a<->b) on every beat (instant, chroma swap not luminance flash —
photosafe since bands are spatially interleaved); (5) keep the phase
changes / family morphs the human liked. Kick = twist surge stays.
Standing law: docs/visualizer-ga.md (taste calibration, hard safety, dust fatigue). Focus (human): EQ + beat responsiveness, dramatic kicks/drops, contrast, movement. Hard cuts/steps land exactly on grid via `beat.ladderBarIndex ?? beat.barIndex` + beat phase; integer things never interpolate.
File: g08-hypno-pulse.candidate.ts.
