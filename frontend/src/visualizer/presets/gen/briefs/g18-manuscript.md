Candidate: g18-manuscript   Kind: novel
Parents: none; meter-as-subject free ideation (gen-18 "more focus on meter").
Prior art acknowledged: g02-mirror-ladder (16-bar story), g14-visible-metric.
Human notes in play: "more focus on meter"; "i like how this one tells a
story, i would love a complete 16-bar story" (mirror-ladder note).
Question: Can musical NOTATION itself — a score page that writes itself in
real time — make bar position readable at a glance while the audio only
decorates the ink?
Instruction: One page = one 16-bar section, laid out as 4 systems (rows) of
4 bar cells. A pen sweeps the current cell with barPhase; every transient
stamps permanent ink at the pen position — kick = large low notehead,
snare = mid diamond, hat = small high tick, vertical placement refined by
centroid at stamp time. Barlines on downbeats, row advance per phrase,
PAGE TURN per section (wipe + palette rotate from trackId genome). Beat
columns in the current cell light hard ON beats (quantized grammar). Past
ink stays; the page is the memory of the section.
Invariants: position on page = bar in section, readable at a glance; dark
paper, earned ink brightness; stamps capped per bar (no unbounded state);
page-turn flash rate-limited (once per 16 bars); luminance parity across
section palettes.
Degrees of freedom: ink density threshold, pen glow, page-turn drama.
Assigned tech: per-band impulses (the stamping alphabet), centroid (note
placement/hue), beat/bar/phrase/section tiers via ladderBarIndex, trackId
genome, bands for pen energy.
Anti-resemblance: no split-flap cells (g16-flip-matrix), no CRT mask, no
dust/powder media, no mirror-fold construction (mirror-ladder).
Contract: default-export VisualizerPreset; canvas 2D with an offscreen page
buffer (incremental stamping, no per-frame full redraw of ink); frame
fields: bands/impulse/trend/centroid/beat/decks/params/time/dt.
Hard rules: self-contained file; bright saturated committed ink colors;
photosensitivity floor; motion terms ride bandsSlow.
