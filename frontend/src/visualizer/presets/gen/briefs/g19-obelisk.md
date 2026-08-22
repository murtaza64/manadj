Candidate: g19-obelisk   Kind: novel (conductor)
Parents: g17-monolith (phase-hosting conductor: layer canvases, 2-sub-renderer
discipline, per-phase crash guard, regime hooks) — same machinery, OPPOSITE
philosophy.
Human notes in play: "do another monolith-type ambitious one too"; "focus on
meter and long evolution... i want to focus on more immediate contrast between
sections and longer periods. focus on the abstract geometric ones rather than
presets that try to depict something real."

Instruction: a CONTRAST-FIRST abstract conductor. Where the monolith holds
phases 2-4 sections and crossfades, the obelisk cuts EVERY 16-bar section
boundary in a SINGLE FRAME (the hardcut lesson: quantized beats smooth).

Phase pool (12, abstract geometry only — no figurative scenes): g09-hypno-glide,
g07-mirror-strata, g10-iris-flat, g10-tricentric, g10-barred, g07-voyage-hardcut,
g12-strobe-column, g16-flip-matrix, g13-truchet, g13-chladni, g13-phyllotaxis,
g12-scanline.

CONTRAST MATRIX: each phase carries a trait vector (topology radial/linear/grid,
density, chroma, glow, energy). The scheduler picks the next phase by maximal
trait distance from the current one (topology flip weighted highest), excluding
the last 3 played — adjacent sections are maximally different by construction.

EPOCH MACRO-ARC on top: 4 sections = an epoch, 8 epochs = a cycle (~17 min at
128 BPM). A complexity curve (rise to epoch 6, resolve through 7-8 back toward
epoch 1) drives every phase visit: params are mapped from calm anchors to hot
anchors by the visit's complexity, and the scheduler's target energy follows the
curve — the same phase revisited in a later epoch looks evolved. A meta-palette
hue rotation (ctx.filter hue-rotate at composite time) completes one full 360°
turn per cycle, so the final epoch resolves back to the opening's color world.

Regime hooks: buildup = inter-phase TENSION SHUTTER — the prewarmed NEXT phase
shows through thin growing slits over the current one (continuous, photosafe)
+ tightening vignette; dropTransition = an armed cut LANDS ON THE DROP when a
boundary is near (≤3 bars), the scheduled boundary cut is then consumed; a
hairline shock ring marks the landing (≥8 s cooldown).

Mechanics: max 2 live sub-renderers (current + next). The next phase prewarms
into its own layer canvas for the last 2 bars of each section (or from
buildup-arming) so feedback engines cut in with a populated field — the cut
itself is one frame. Every sub-render is try/catch-guarded; crashed phases are
dead for the session; the obelisk never dies with a phase.

Genome (dominant-deck trackId): scheduler jitter, per-visit param jitter,
starting phase, base hue offset.

Assigned tech: beat.ladderBarIndex ?? beat.barIndex hypermeter, frame.regime
(buildup/dropTransition), frame.dominantChannel genome, bandsSlow via hosted
phases.

Contract: default-export VisualizerPreset; frame fields available:
bands/impulse/trend/centroid/beat/decks/spectrum/wave/params/time/dt.
Hard rules: self-contained conductor (hosts other candidates by import, like
g17-monolith); no protocol or bridge changes; photosensitivity floor (cuts are
1 per ~30 s, shutter/vignette continuous, stinger cooldown ≥8 s); luminance
parity across cuts (the pool mixes dark and bright phases — cuts are aperiodic
and ≥16 bars apart, and the meta-grade never raises brightness).
