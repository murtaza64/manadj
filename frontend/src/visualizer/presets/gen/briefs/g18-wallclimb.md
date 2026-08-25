Candidate: g18-wallclimb   Kind: novel
Parents: none; meter-as-subject free ideation (gen-18 "more focus on meter"
— the handoff names "a climber ascending a 16-bar wall" explicitly).
Human notes in play: "more focus on meter"; legible causality; quantized
grammar wins.
Question: Can a CHARACTER's journey — one climber, one 16-ledge wall, one
section — carry bar position as body height, with every beat a visible
quantized move?
Instruction: A wall of 16 ledges (bottom = bar 0, top = bar 15) fills the
frame; the whole section is visible at once. The climber snaps one
hold-move per BEAT (integer jumps, 0.1s settle) and stands on a new ledge
every BAR; passed ledges stay dimly lit (the trail is the bar count). At
the section boundary the climber summits — one bounded flare — then the
wall re-skins (palette/route from trackId + section) and the climber
rappels to the base in ~0.4s. Buildup regime = coiled squash before the
next move; dropTransition = an overshoot leap. Ornaments: kick = solid
grip shockwave ring + wall shudder; snare = crack-network flash across a
passed ledge (no powder); hats = glints on the bolt anchors. Backdrop:
dark rock strata with edges lit by the 24-band spectrum.
Invariants: height = bar-in-section at a glance; lit holds = beat-in-bar;
moves happen ON the grid only; dark floor, earned brightness; summit flare
rate-limited (once per 16 bars); no dust/powder media.
Degrees of freedom: climber silhouette, strata contrast, crack style.
Assigned tech: impulse.low/mid/high (shockwave/crack/glints), 24-band
spectrum (strata), regime buildup/dropTransition (squash/leap), tiers via
ladderBarIndex, trackId genome, bandsSlow for any drift.
Anti-resemblance: no mirror-fold ladders (g02-mirror-ladder), no strobe
columns, no orrery gears, no CRT mask.
Contract: default-export VisualizerPreset; canvas 2D; frame fields:
bands/impulse/trend/regime/spectrum/beat/decks/params/time/dt.
Hard rules: self-contained file; bright saturated colors; photosensitivity
floor; motion terms ride bandsSlow.
