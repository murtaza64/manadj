# g08-crt-eq

Candidate: g08-crt-eq   Kind: tweak (spectrum-mapping study)
Parents: g07-crt (3 approvals).
Human ask: spectrum->parameter mapping across families; more EQ
responsiveness.
Instruction: copy g07-crt (programs, channel changes, tube pipeline
stay). New mapping layer: LOWS = vertical hold / frame stability + beam
intensity floor (bass kill = picture stabilizes eerily clean; heavy
bass = sag + hum bar crawling upward); MIDS = program CONTENT color
(the program's palette hue tracks mid spectral content — EQ mid sweep
repaints the show); HIGHS = phosphor/scanline detail (high highs =
crisp aperture grille + sharp scanlines + edge ringing; high kill =
soft blurry tube). Kick = beam slam (parent). Beat = subtle raster
brightness comb stepping down one scanline block per beat (localized).
The three mappings must be independently legible on EQ sweeps.
Standing law: docs/visualizer-ga.md (taste calibration, hard safety, dust fatigue). Focus (human): EQ + beat responsiveness, dramatic kicks/drops, contrast, movement. Hard cuts/steps land exactly on grid via `beat.ladderBarIndex ?? beat.barIndex` + beat phase; integer things never interpolate.
File: g08-crt-eq.candidate.ts.
