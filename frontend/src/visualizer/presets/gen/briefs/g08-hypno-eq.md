# g08-hypno-eq

Candidate: g08-hypno-eq   Kind: tweak (spectrum-mapping study)
Parents: g07-hypno (1017).
Human ask: "lows influence property a, mids influence colors, highs
influence something else" — applied to the hypno engine.
Instruction: copy g07-hypno with the note fixes (constant speed, energy
->glow — see g08-hypno-pulse brief) then map the spectrum to pattern
properties: LOWS = band contrast depth + twist amount (heavy bass =
ink-black tight coils; bass kill = loose soft spiral — EQ kill must
visibly relax the pattern); MIDS = the traveling palette of band A (hue
center follows mid-band spectral content / centroid); HIGHS = band B
edge treatment (crisp shimmer fringing at high highs, soft matte edges
without). Kick = twist surge. Beat = A/B swap. The three mappings must
be INDEPENDENTLY legible: sweep one EQ knob and see one property move.
Standing law: docs/visualizer-ga.md (taste calibration, hard safety, dust fatigue). Focus (human): EQ + beat responsiveness, dramatic kicks/drops, contrast, movement. Hard cuts/steps land exactly on grid via `beat.ladderBarIndex ?? beat.barIndex` + beat phase; integer things never interpolate.
File: g08-hypno-eq.candidate.ts.
