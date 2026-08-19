# g08-orrery-tick

Candidate: g08-orrery-tick   Kind: tweak (radical reinterpretation)
Parents: g06-orrery (1030) / g07-orrery-calm (0/2).
Human notes: "a little too fast to see anything" then "even this seems
way too fast most of the time to see whats going on". Diagnosis:
continuous rotation at ANY speed reads as spinning. Fix: STOP SPINNING.
Instruction: escapement clock. Gears are STATIC between events and TICK
in discrete steps: the beat gear advances one tooth per BEAT (snap +
tiny overshoot settle, like a second hand); the bar gear one tooth per
BAR; the phrase gear one tooth per PHRASE; the section wheel one tooth
per SECTION (metric hierarchy as clockwork — you can READ the meter off
the mechanism). Kick = the escapement STRIKE (pendulum/hammer hits, the
beat gear's tick is driven by it visually). Mids = warm glow flowing
through the gear train (color); highs = jewel glints on teeth
(localized). Drop = the clock RUNS FREE — continuous fast rotation ONLY
during max(drop, energy), then catches and returns to ticking (the
contrast IS the drama). Buildup = pendulum swings wider, ticks harder.
Keep g07-orrery-calm's larger gear sizes + edge-light contrast.
Standing law: docs/visualizer-ga.md (taste calibration, hard safety, dust fatigue). Focus (human): EQ + beat responsiveness, dramatic kicks/drops, contrast, movement. Hard cuts/steps land exactly on grid via `beat.ladderBarIndex ?? beat.barIndex` + beat phase; integer things never interpolate.
File: g08-orrery-tick.candidate.ts.
