# g13-galvanic — dielectric breakdown / electrical discharge

Candidate: g13-galvanic   Kind: novel
Territory: NATURAL PHENOMENA & PHYSICS — lightning / electrical discharge.
Not in the pool; honors the anti-resemblance list (no feedback-starfield,
no tunnels, no spirals, no aurora curtains, no FBM nebulae, no ink/plates,
no color-organ ribbons). The medium is ARCS, not dust/powder (dust fatigue).

## Falsifiable question
Can a fractal-branching electrical discharge that FIRES on the kick and
LIGHTS what it passes read as a distinct, legible physical event — charge
accumulating in a buildup, breakdown on the drop — without becoming glow
soup or a strobe?

## Concept
A dark dielectric gap between two charged electrodes (top rail and bottom
rail). Bass energy accumulates as visible CHARGE on the rails (a taut,
tense glow that builds in a buildup, never "eerily still"). When a kick
lands, dielectric breakdown fires a fractal lightning bolt across the gap:
a bright main channel with recursive side-branches (a midpoint-displacement
tree). The bolt is a one-shot that LIGHTS the field it crosses (traveling
ripple idiom, voyage/odyssey engine reuse) then decays fast, leaving a
dim ionized after-trail on the feedback field that contracts to black.

Corona/St-Elmo sizzle (fine sparks along the rails) rides the high band.
On the drop, breakdown goes continuous — a sustained storm of branching
strokes riding max(drop, energy), the gap saturated with plasma but the
FLOOR still dark between strokes (legible causality: you see each stroke).

GL fragment shader with feedback (`createGlRenderer`, feedback:true,
context-loss safe). The discharge geometry is computed on the CPU
(a branching polyline tree, midpoint-displaced) and passed to the shader
as a small set of segment uniforms; the shader renders glowing capsules
(distance-to-segment) additively over the contracted previous frame.

## Band → vocabulary (DISTINCT per band)
- **low (bass)** → CHARGE on the rails + the MAIN STROKE. Rising bass
  charges the rails (tense glow). `impulse.low` (kick) FIRES the main
  bolt — the one scene-scale solid event. Kick is the only trigger for a
  full main channel (gate on impulse.low so it never reads as "kick powder").
- **mid** → LEADER FLICKER + SIDE BRANCHES. `impulse.mid` (snare) spawns
  a burst of shorter secondary strokes / branch density; mid level sets how
  many recursive branches the tree grows.
- **high** → CORONA SIZZLE. `impulse.high` (hats) sprays fine spark points
  along the electrodes and stroke path — a shimmering fringe, NOT dust:
  sharp bright glints that die in one frame.

## Kick / drop / buildup grammar
- **KICK** (impulse.low): fire main bolt. Bolt path regenerated per fire
  (splitmix seeded by fire count + trackId). Full-gap channel, bright core,
  fast decay (~0.18s). The bolt LIGHTS a horizon ring as it lands.
- **SNARE** (impulse.mid): secondary branch burst, localized flicker.
- **BUILDUP** (trend.excitement, mid-weighted): rail charge climbs, air
  ionizes (a faint pre-breakdown filament stress), corona intensifies.
  Tense-but-alive; ceiling tuned slightly down.
- **DROP** (smoothed max(drop,energy), bass-gated): continuous storm —
  strokes fire on beat subdivisions, branch depth up, ionized trail
  persists longer (but field stays contractive; dark floor between strokes).
- **PHRASE / SECTION** (beat.ladderBarIndex ?? barIndex): electrode
  polarity flips (top⇄bottom origin) on phrase; palette regime cross-fades
  on section (electric-blue → violet → sodium-orange → green plasma).

## Palette policy
Committed, bright, fully saturated electric families (project taste: NO
pastels). Four families the trackId genome selects/cross-fades between:
arc-blue/white, violet corona, sodium-orange (street-lamp arc), green
plasma. Luminance-parity across families (mean glow comparable so section
swaps read as chroma events, not brightness flashes). Chroma-preserving
soft knee on the additive composite (never per-channel clamp). Dark floor
always; brightness earned by strokes.

## Photosafety
The only near-full-field brightening is the drop storm; each stroke is a
one-shot with fast decay, and the feedback grade is capped < 1 (contractive)
so strokes cannot compound into a full-field flash. Stroke firing is
rate-limited by the beat subdivision on drops (< 3 full-field cycles/sec).
No saturated-red strobing (palettes are blue/violet/orange/green cores,
red never a two-color pair). Corona glints are localized → exempt.

## Assigned tech
Per-band impulses (kick fire / snare branch / hat corona — PRIMARY),
band envelopes + bandsSlow (charge, storm rate), trend drop/buildup split
(smoothed ~0.35s), beat phase + ladder tiers (drop subdivisions, polarity
flip, palette regime), trackId genome (bolt seeds + palette order),
centroid (core color-temperature bias). GL feedback (contractive).

## Params (3–5)
- `charge` — rail charge glow gain (0.5–1.6, default 1.0)
- `branch` — branch depth / density (0.6–1.6, default 1.0)
- `decay` — feedback persistence of ionized trail (0.5–0.92, default 0.72)
- `boltWidth` — main channel thickness (0.5–1.8, default 1.0)
