# g14-facade — architecture, fourth attempt: light on stone, camera on a tripod

Candidate: g14-facade   Kind: novel (clean-room remake)
Parents: none (concept resurrection; fossils g02-monolith,
g03-monolith-lux, g06-negative read only for the autopsy)
Human notes in play: "needs work but interesting" (g02-monolith), "the
smoke is really bad" (g03-monolith-lux); g06-negative died dark and
illegible.

## Falsifiable question
Can architecture finally land when the buildings are matte-dark stone,
ALL the music lives in their WINDOWS, and the camera is a tripod that
only CUTS on section boundaries — no smoke, no fog, no bright columns,
no continuous camera motion at all?

## Fossil autopsy (what this remake must not repeat)
- THREE haze sources stacked in lux: screen-space snare fbm dust +
  exp depth fog + additive feedback smear. Banned entirely: this preset
  has NO fog term, NO screen-space noise overlay, NO feedback buffer.
- Camera sway + drop dolly + fov modulation (g02/g03) and g06's wrap-pop
  processional = the motion offenders. Here the camera is STATIC between
  section-boundary CUTS among 4 genome vantage points (hardcut grammar —
  a cut is a scene change, not a flash).
- g06's near-black stone carried no form. Here the stone stays dark but
  the WINDOW GRID carries constant legible structure with a lit floor —
  never blank, never murky.

## Concept
A night skyline: two ranks of matte towers over a dark ground, flat
gradient sky, no atmosphere. The music is the CITY'S ELECTRICITY:
- Windows re-hash their lit pattern every BAR (quantized event — the
  city "changes its mind" on the bar).
- Three window STRATA per tower (bottom/middle/top) are lit by
  low/mid/high band levels — the EQ reads as which floors are awake
  (the best idea in lux, kept and centered).
- KICK = a flood wave rising up the facades (localized gaussian front,
  ~2 s decay). SNARE = one hashed window-cluster flashes. HATS = rooftop
  beacon glints.
- PHRASE = one new tower RISES over ~1.5 s (geometry, no light needed).
- SECTION = camera cut + massing re-roll + palette bank step (one shot,
  one skyline, one color regime per section).
- DROP (ride max(drop, energy)) = lit fraction jumps citywide + warm
  bias, held on the plateau. BUILDUP = light MIGRATES upward (lower
  strata dim, top stratum climbs) — tense but alive.

## Invariants
- No fog/smoke/volumetrics/dust of any kind; no feedback buffer.
- Camera translates ZERO pixels per frame; only section cuts.
- Window-light floor ≥ 0.12 lit fraction — the skyline never goes black.
- Bright saturated window colors on dark stone (earned brightness).

## Degrees of freedom
1. Massing genome (heights/widths/depths per section re-roll).
2. Vantage set (4 genome camera positions).
3. Palette banks (4 saturated window-light schemes, luminance parity).

## Assigned tech
band envelopes (strata), per-band impulses (flood/cluster/beacons),
trend split ~0.35 s (drop lit-surge, buildup migration), beat
bar/phrase/section tiers via `ladderBarIndex ?? barIndex` (window
re-hash, tower rise, cuts), trackId genome (massing/vantage/palette),
centroid (window temperature).

## Anti-resemblance
No raymarch fog, no emission volumes, no feedback trails — the pool's
architecture attempts all leaned on atmosphere; this one is hard
surfaces and hard light only.

## Params
- `density` — towers per screen width (0.6–1.6, default 1)
- `litFloor` — quiet-state lit fraction (0.05–0.35, default 0.15)
- `flood` — kick flood gain (0–1.6, default 1)
- `glow` — window emission gain (0.5–1.8, default 1)
