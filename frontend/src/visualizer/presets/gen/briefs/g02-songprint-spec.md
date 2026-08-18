# Shared spec: the SONG GENOME family (three candidates)

Goal (human, verbatim): "a preset where no two songs look alike, due to
thorough use of spectrum, energy, bpm, phrase info to parameterize a bunch
of different stuff. take all the best parts of voyage but go for some
other visual directions. go ambitious on effects. i'm a fan of evolution,
strong drops, vibrant buildups."

## The song genome (all three candidates implement this JS-side)

1. DETERMINISTIC SEED: dominant audible deck's trackId (frame.decks,
   highest level). Hash it (e.g. splitmix-style integer hash) into 4-6
   stable scalars in [0,1] → discrete/structural choices (geometry family,
   symmetry count, palette family, pattern frequencies). Same song ⇒ same
   look, every play. Fallback when no trackId: freeze the slow stats below
   as a pseudo-seed.
2. SLOW STATS (EMA, tau ~15 s): centroid, spread, flatness, energy, plus
   beat.bpm → continuous genome: bpm scales ALL motion/pattern rates (174
   must move differently than 122), avg centroid → base palette
   temperature, avg spread → structural density/breadth, avg flatness →
   texture (smooth↔granular).
3. TRACK CHANGE = REBIRTH: when the dominant trackId changes, stage a
   visible re-genesis over ~2 s (the old structure collapses/dissolves
   into the new genome's structure). The transition is a spectacle.
4. LIVE LAYER: bands/impulses for moment-to-moment life; kicks SOLID
   (taste calibration applies); snare powder welcome.
5. EVOLUTION: in-phrase continuous development (swell/growth/tightening,
   anticipation in the last bar); section boundaries = theatre.
6. STRONG DROPS: the biggest visual event in the language — regime
   slam, shockwave, full bloom (drop = smoothed excitement×bass).
7. VIBRANT BUILDUPS: NOT dimmed — buildups saturate and energize (color
   surge, rising motion, accumulating tension elements) while staying
   distinct from the drop's release. (This supersedes earlier "buildups
   dim" tuning — tense AND vibrant.)

## Inherited engine idioms (from voyage/odyssey — docs/visualizer-ga.md)
unsharp feedback tap, chroma-preserving soft knee, per-axis seed-mixed
hashes, traveling kick ripple that lights the medium, drop-aware genome
overrides, wide-phase palettes. HARD RULE: photosensitivity floor
(≤3 full-field flashes/s, no saturated-red strobes).

## What NOT to do
Not another space nebula/galaxy — each candidate has its own visual
direction (individual briefs). GL feedback pipeline available
(createGlRenderer, u_prev), hiRes: true.
