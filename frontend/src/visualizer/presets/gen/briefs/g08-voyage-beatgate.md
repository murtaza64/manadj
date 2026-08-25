# g08-voyage-beatgate

Candidate: g08-voyage-beatgate   Kind: tweak (beat-grammar + alt-high)
Parents: g00-voyage (1044; engine presets/voyage.ts — g00 file is a
re-export).
Human ask: voyage variants with more beat-based effects + alternative
high/mid responses.
Instruction: copy the voyage engine; add structural beat gating: spiral
dust LANES illuminate one-per-beat around the disk (a lit sector
advances with the beat like runway lights — structure appears on the
grid, luminance envelope smooth/photosafe); horizon ring is segmented
and segments charge per beat, completing on the downbeat (bar position
readable off the ring). ALTERNATIVE HIGH response: no high nebula
powder — highs = crystalline GLINTS along lane edges (crisp specular
points, density from high band). ALTERNATIVE MID response: mids = lane
WIDTH/breathing rather than dust amount. Kick = parent ripple + the lit
sector SLAMS bright. Drop = all segments/lanes lit at once + parent
drama on max(drop, energy).
Standing law: docs/visualizer-ga.md (taste calibration, hard safety, dust fatigue). Focus (human): EQ + beat responsiveness, dramatic kicks/drops, contrast, movement. Hard cuts/steps land exactly on grid via `beat.ladderBarIndex ?? beat.barIndex` + beat phase; integer things never interpolate.
File: g08-voyage-beatgate.candidate.ts.
