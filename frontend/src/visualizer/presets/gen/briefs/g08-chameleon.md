# g08-chameleon

Candidate: g08-chameleon   Kind: novel (human tech idea, in-preset
derivation)
Parents: none; medium language free (respect MEDIUM DIVERSITY — no fine
dust).
Human ask (verbatim): "a measure of 'tonality' would be nice for a
preset thats colorful when sounds are melodic and more monotone and
kinetic when sounds are more percussive".
Available signals: `flatness` ALREADY SHIPS in frames (spectral
flatness: low = tonal/melodic, high = noisy/percussive) — no new seam
needed. Derive TONALITY in-preset: tonality = smoothed over ~750ms of
(1 - flatness), further reduced by percussive transient density (track
recent impulse.low/mid rate in a rolling window — many transients =
percussive even when flatness dips). Two regimes with a continuous
blend, NEVER a hard flip (smooth 500ms+ crossfades):
- TONAL/MELODIC pole: the scene turns PAINTERLY AND COLORFUL — rich
  multi-hue palette blooms, soft luminous forms (aurora-like washes of
  saturated color), gentle drift; band identity via shape as always.
- PERCUSSIVE pole: color drains to a stark MONOTONE (one hue + black/
  white) and the scene turns KINETIC — hard geometric strokes, snappy
  motion, every kick a visible strike, every snare a slash; movement
  carries the energy that color no longer does.
Kick = solid strike in both regimes (bigger/harder at the percussive
pole). Drop rides max(drop, energy) — at the tonal pole a chromatic
bloom surge; at the percussive pole a monochrome kinetic frenzy.
Phrase/section via `beat.ladderBarIndex ?? beat.barIndex`: section
boundary re-rolls the monotone hue + the tonal palette family. The
TRANSITION itself is a showpiece: color visibly drains/floods as the
music's character changes (traveling desaturation front, not a global
fade).
Assigned tech: flatness (primary), impulse history, bands, ladder
tiers, trend, centroid (tonal-pole hue bias).
Anti-resemblance: no dust; not a voyage skin.
File: g08-chameleon.candidate.ts. Standing law: docs/visualizer-ga.md.
