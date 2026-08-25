Candidate: g13-lantern   Kind: novel
Parents: none (fresh territory — LIVING THINGS & NARRATIVE)

Territory: living things & narrative. Concept: a LIGHTHOUSE on a dark
headland sweeping its beam across a night sea; SHIPS sail in on the beat
grid and the beam CATCHES them. Legible causality: the beam rotates in
quantized stations (a real rotating optic clicks between facets), a ship
lit by the beam flares its lantern; the beacon FLASHES on the kick. Staged
storytelling with legible actors (lighthouse + ships) — the premise the
dossier explicitly welcomes.

Falsifiable question: does a QUANTIZED rotating-beam grammar (the beam
snaps between N facet-stations on the metric grid, not a continuous smear)
plus legible ship actors beat the "too-fast-to-read / washy" failure mode —
i.e. is a lighthouse a legible clock the eye can follow?

Anti-resemblance: aurora/curtain, tunnels, spirals, CRT, warehouse/blackout
strobe families exist; this is a FLAT matte silhouette scene (headland,
tower, sea horizon, ships), not a fluid/particle field. The beam is a hard
solid wedge, not glow soup. Distinct from g11-shadow's light-choreography:
that was a static monolith field lit from outside; this MOVES a beam and
has traveling ship actors with their own arrivals.

Band vocabulary (distinct per band):
- LOW (bass) — the BEACON. impulse.low = the lamp FLASH (the tower's light
  room pulses a solid warm burst; localized, photosafe). bands.low = sea
  swell height (the horizon heaves slowly — bandsSlow, a slow attribute).
- MID — the BEAM body: bandsSlow.mid sets beam sweep RATE and beam length/
  reach across the water. Mid presence = a wider, longer wedge.
- HIGH — SPRAY + ship-lantern glints: impulse.high paints thin bright
  hairlines of spray at the headland rocks and a glint on each lit ship
  (discrete filaments, not dust/glow).
- centroid/flatness — sky/sea TINT + weather: tonal (low flatness) = clear
  deep-indigo night, cohesive; noisy/high flatness = storm murk, desaturated
  overcast. Centroid swings horizon warm↔cold.

Dramatic kicks / quantized grammar:
- The BEAM lives on the metric grid: it snaps to a new facet-station once
  per beat (a rotating-optic click), so shadows/beam angle change in hard
  integer jumps — quantized, legible, never a continuous washy sweep.
- SHIPS arrive on the bar: a new ship silhouette sails in from a screen edge
  on each bar downbeat (beat-locked spawn); it drifts across; when the beam
  station points at it, its lantern LIGHTS (the catch — the payoff moment).
- BEACON FLASH gated on impulse.low (kick clicks are broadband — gate to
  read as beacon, not "kick powder"), <=2/s, localized.
- DROP = the STORM: sea swell rides max(drop, energy), beam sweeps its
  facet-clicks faster (still quantized), more ships crowd the water, spray
  intensifies. Sustained (rides max(drop,energy)), not a twitch.
- BUILDUP = gathering weather: horizon darkens, swell rises, tension — alive
  (ships still moving), never eerily still.
- SECTION (ladder %16) = new palette regime + new facet-station count
  (hard cut, scene-scale). Phrase (%4) = beam reach nudge.

Assigned tech: impulse.low/high (beacon flash, spray/glint), bands.low +
bandsSlow (swell height, beam rate/reach), trend drop/buildup split (storm/
gather), spectral centroid + flatness (tint, weather), 24-band spectrum
(ships-in-flight count/positions), beat phase + ladder tiers
(beat.ladderBarIndex ?? beat.barIndex — beam facet clicks per beat, ship
spawn per bar, section palette/facet-count), trackId genome (headland
layout + palette order). Canvas 2D — flat matte fills, hard beam wedge,
committed palette, dark sea floor.

Invariants: photosensitivity floor (beacon flash rate-limited, localized;
beam sweep is a moving wedge not a full-field flash); dark sea/sky floor
always; committed saturated palette per section (bright, not pastel);
sweep/swell rates ride bandsSlow; legible causality (beam catches ship →
lantern lights); no glow soup, no dust, no translucent wash; quantized beam
grammar is the point.

Degrees of freedom (params, 3): beamReach (wedge length across water),
beamWidth (facet wedge angular width), seaLevel (horizon height).

Contract: default-export VisualizerPreset; self-contained; frame fields
bands/impulse/trend/centroid/flatness/beat/decks/spectrum/params/time/dt.
Hard rules per kit standing law (not restated).
