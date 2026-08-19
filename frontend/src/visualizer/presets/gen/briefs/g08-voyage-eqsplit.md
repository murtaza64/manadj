# g08-voyage-eqsplit

Candidate: g08-voyage-eqsplit   Kind: tweak (spectrum-mapping study)
Parents: g00-voyage (1044; engine presets/voyage.ts).
Human ask (verbatim): "lows influence property a, mids influence colors
of various things, highs influence something else".
Instruction: copy the voyage engine; enforce a STRICT property split:
LOWS = geometry (disk scale, warp depth, horizon height — bass kill
visibly flattens/shrinks the space, heavy bass inflates it); MIDS =
COLOR of everything (palette hue center + saturation track mid spectral
content; mid kill drains toward duotone); HIGHS = fine detail density
(star count tier, lane edge sharpness, filament brightness; high kill =
soft/empty, high boost = crystalline busy). Each EQ knob must read
independently. Kick/drop drama per parent (kick ripple, drop rides
max(drop, energy)). Snare = brief detail-layer sparkle (mid/high gated,
no powder).
Standing law: docs/visualizer-ga.md (taste calibration, hard safety, dust fatigue). Focus (human): EQ + beat responsiveness, dramatic kicks/drops, contrast, movement. Hard cuts/steps land exactly on grid via `beat.ladderBarIndex ?? beat.barIndex` + beat phase; integer things never interpolate.
File: g08-voyage-eqsplit.candidate.ts.
