# g17-monolith — the hour-scale conductor

Candidate: g17-monolith   Kind: novel (conductor over existing engines)
Parents: the voyage/odyssey and materia families + tunnel-saga — 11 curated
phase engines, statically imported and hosted as PHASES.
Human notes in play: "monolith preset with many phases and components to
change, evolves at drops, buildups, doubles etc, interesting and dynamic
enough to look at for a full hour is target. should go through various
visual styles, techniques, palettes etc etc" · "arrange the voyage/odyssey
family and the materia family into the ambitious 'monolith' preset… could
also be fun to try adding specific buildup and drop sections".

Instruction: a CONDUCTOR preset. Each phase is an existing candidate engine
rendered into its own layer canvas (VisualizerApp's Layer/morph pattern) and
composited. Phase roster (contrast between adjacent phases + an energy arc):

- g03-materia-deep (calm crystalline depths)
- g00-voyage (classic advected fluid)
- g07-seasons-neon (neon seasonal palettes)
- g01-odyssey (phrase-evolving journey)
- g05-prime-embers (ember updraft)
- g04-tunnel-saga (canvas-2D narrative tunnel)
- g02-voyage-prime (hotter fluid)
- g05-materia-shards (glass shard bursts)
- g03-solar-crown (solar corona)
- g07-voyage-hardcut (hard-cut banks)
- g07-materia-metric (metric-locked slabs)

SCHEDULE (hypermeter): a phase holds 2-4 sections (32-64 bars via
`beat.ladderBarIndex ?? beat.barIndex`, 16-bar sections; pseudo-meter at
128 BPM without a grid), then crossfades (~4 bars) on a section downbeat.
Genome (dominant-deck trackId) picks one of three hand-curated arc
orderings plus a rotation — order varies per track, adjacency contrast is
guaranteed by curation.

Musical events OVERRIDE the clock (frame.regime's debut):
- regime.buildup rising → BUILDUP SECTION: riser overlay composited over
  any phase — converging spokes, contracting rings, rising horizon glow,
  tightening vignette. Photosafe: continuous, no full-field flashing.
- regime.dropTransition firing after a buildup (and ≥1 section residency)
  → the phase CUT lands on the drop: fast ~1-bar crossfade + a one-shot
  radial drop stinger (≥8 s cooldown).
- deck DOUBLES (two decks, same trackId) → phase-blend flourish: the NEXT
  phase teased in lighter-composite at low alpha while the double holds.
- regime.breakdown → the live phase's params ease toward calm (defaults
  eased toward min) + a slow dark vignette.

RESOURCES: at most 2 live sub-renderers (current + incoming/tease),
created lazily, dropped after the fade (GL context limits). Sub-params:
declared defaults, genome-jittered ±12% of range. Every sub-render is
try/catch-guarded: a crashing phase is marked dead for the session and
skipped — the monolith never dies with it.

Contract: default-export VisualizerPreset; frame fields available:
bands/impulse/trend/regime/centroid/beat/decks/spectrum/params/time/dt.
Hard rules: conductor file is self-contained apart from sibling candidate
imports; no protocol or bridge changes; photosensitivity floor; motion
rates ride smoothed signals; bright saturated colors come from the phases.
