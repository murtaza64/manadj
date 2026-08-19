Candidate: g13-signal-box   Kind: novel
Territory: URBAN / MECHANICAL / HUMAN-MADE
Parents: none (fresh idea). FLAT canvas-2D discipline from g10-poster; hard
metric quantization from the mirror/materia-metric lineage; departure-board
flip-dot rows nod to CRT-family legibility without being CRT.

Human notes in play (verbatim):
- "FLAT design ... solid matte fills, hard edges, committed 3-5 color schemes,
  motion by transforms and color swaps ... pops, flips, wipes, scheme swaps."
- "QUANTIZED grammar: hard cuts on the metric grid, integer jumps."
- "LEGIBLE CAUSALITY: you can see WHY something moved."
- "STRUCTURE and MATERIAL identity."

Falsifiable question: does a RAILWAY INTERLOCKING — a signal gantry of colored
aspect lamps, mechanical point/switch levers that THROW on kicks, a bright
TRAIN pulse that runs a track locked to the beat, and a flip-dot departure
board spelling the spectrum — read as a purpose-built signalling machine with
obvious cause-and-effect, or does it read as decoration?

Concept: a flat black signalling scene, hard-edged and diagrammatic like a
track schematic. Top: a SIGNAL GANTRY — a row of railway signal heads, one per
mid-spectrum group, each head a stack of round aspect lamps (red/yellow/green/
double-yellow). The lit aspect per head is chosen by that band's level
(quantized: danger=dark band, caution=low, clear=high) — an EQ kill on a
channel drops a whole head to RED (danger), visibly. Middle: the TRACK — a
horizontal schematic line with POINTS (switches). A bright TRAIN (a solid
rounded block) runs left-to-right along the track locked to the beat: it steps
integer TRACK-CELLS per beat, and LIGHTS the signal it passes (the aspect it
approaches goes clear then drops back). Kicks THROW a switch — a point lever
snaps to its other position with a hard flip (quantized angle, two states
only), routing the train onto a branch. Bottom: a FLIP-DOT DEPARTURE BOARD —
rows of discrete dots; the lit dot-count per row spells the fine spectrum
(24 bands mapped to board rows), dots flipping in hard steps (never smooth).

Band vocabulary (DISTINCT per band):
- LOW  = the TRAIN's mass/speed and the switch machinery. Kick (impulse.low,
         gated broadband) = a POINT THROWS (lever snaps, hard two-state flip)
         and the train lurches one cell.
- MID  = the SIGNAL ASPECTS: each gantry head's shown aspect steps with its
         band (danger/caution/clear), snare (impulse.mid) = a head cycles its
         aspect in a hard flip.
- HIGH = the flip-dot board's top rows fill (impulse.high, discrete dots) +
         crisp lamp GLINTS on the lit aspect (single hard highlight, gated —
         not dust).
- BEAT drives the train's integer track-cell march (beat.barPhase / beatInBar)
  and the departure-board scroll tick.

Metric grammar (quantized, hard cuts):
- BEAT: train advances one track cell; board scrolls one column; passed
  signal clears then resets.
- BAR (ladderBarIndex ?? barIndex): the ROUTE re-locks — which branch the
  points favour flips; the "next departure" highlighted row rotates.
- PHRASE (%4): the track LAYOUT recomposes (branch positions / point count
  re-drawn from genome, hard cut).
- SECTION (%16): livery PALETTE swap across committed schemes (heritage BR
  green; hazard amber/black; neon transit; blueprint white/cyan), hard cut.
- DROP: ALL signals go CLEAR (green blaze), the train runs FLAT-OUT (fast
  integer cells), the board fills; brightness rides max(drop, energy),
  photosafe. BUILDUP: signals hold DANGER and FLUTTER between danger/caution
  (tense-but-alive), points twitch — the interlocking "waiting" — never still.

Palettes (committed, bright saturated, dark floor — NO pastels): signal
red/amber/green on near-black; hazard amber+white on charcoal; neon-transit
magenta/cyan on deep-indigo; blueprint cyan/white on navy. The scene floor is
always flat near-black — lamps and the train are the earned brightness.

Genome: dominant deck trackId seeds head count, track branch topology + point
positions, phrase recomposition sequence, starting livery — same song, same
interlocking. No trackId => frozen pseudo-seed.

Degrees of freedom (params, 3):
- heads     (signal head count / board row density)
- speed     (train base cells-per-beat scaling)
- board     (flip-dot board size / presence)

Invariants / hard rules:
- Self-contained; default-export VisualizerPreset; canvas 2D, source-over
  (NO feedback buffer, NO GL).
- FLAT: solid matte fills, hard edges; lamps are binary lit/unlit discs;
  flip-dots binary; the train a solid block. No gradients, no glow haze.
- Quantized: aspects (3 states), points (2 states), train cells, board dots,
  board scroll — all INTEGER; never smooth-interp a discrete state.
- Kick gated on impulse.low (points/train lurch); highs own dots+glints.
- bandsSlow.* for train SPEED and any climbing fill; instantaneous bands/
  impulse for aspect state, stamps, flips, glints (motion-smoothness law).
- beat.ladderBarIndex ?? beat.barIndex tiers; smoothed drop/buildup (~0.35 s);
  sustained states ride max(drop, energy).
- Photosensitivity: no >3 full-field flashes/s; aspect/dot/point flips are
  LOCAL; the drop green-blaze is rate-limited (staged head-by-head, not one
  full-field flash).

Assigned tech: 24-band spectrum (aspects + board), bandsSlow (train speed /
fills), per-band impulses (kick point-throw, snare aspect-flip, hat dots),
beat phase + beatInBar (train march / board scroll), ladder bar/phrase/section
tiers, trend drop/buildup split, deck trackId genome.

Anti-resemblance: NOT orrery (that's celestial gears), NOT pinball (that's a
playful ball machine), NOT scanline/strobe-column, NOT CRT (no phosphor/
barrel/channel-glitch — the flip-dot board is mechanical dots, not a raster).
No particle field, no fluid, no feedback. A signalling interlocking is its own
machine.
