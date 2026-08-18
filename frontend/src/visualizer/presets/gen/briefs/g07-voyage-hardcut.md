# g07-voyage-hardcut

Candidate: g07-voyage-hardcut   Kind: tweak (temporal-grammar variation)
Parents: g00-voyage (1044; real engine in presets/voyage.ts).
Human ask (verbatim): "a voyage variant with some kind of hard cut at
phrase boundaries (color, shape, polygon number (original inspiration
for this thought was smooth polygon morphing looking weird), effects
etc?)". Insight: smooth interpolation between discrete structures reads
as mush — QUANTIZE instead.
Falsifiable question: do INSTANT discrete jumps at phrase boundaries
(nothing eases, everything snaps together on the downbeat) read better
than continuous morphs?
Instruction: copy the voyage engine. Define a phrase LOOK as a discrete
tuple: {palette bank, arm/symmetry count (integer — e.g. spiral arms
2/3/5/7, never interpolated), effect set (ring on/off, streak on/off,
lens direction, star density tier), rotation direction}. At every
phrase boundary (`beat.ladderBarIndex ?? beat.barIndex`, phrase = 4
bars), CUT to the next look on the exact downbeat — one frame, no
crossfade, no morph. Look sequence is trackId-genome seeded (same song
= same sequence); section boundaries jump to a distant look family
(bigger delta). Within a phrase everything is the parent's continuous
motion — the contrast between within-phrase fluidity and boundary
discontinuity IS the aesthetic. Kick/drop drama per parent, plus: the
final beat before a cut gets a subtle anticipation tick (charge rises),
and a drop landing on a boundary makes the cut also a brightness/
saturation slam (rides max(drop, energy)).
Photosafety: cuts are ≤1 per 4 bars — far under any flash limit; the
cut changes chroma/structure, keep the luminance step moderate.
Invariants: parent motion engine within phrases.
Assigned tech: ladder tiers (primary), genome, beat phase (cut timing
precision), trend.
File: g07-voyage-hardcut.candidate.ts. Standing law: docs/visualizer-ga.md.
