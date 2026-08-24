# g14-saga-fullbleed

Candidate: g14-saga-fullbleed   Kind: tweak (tunnel-class bugfix + glare trim)
Parents: g04-tunnel-saga (score 6, top tunnel mutant: 16-bar dream→punch
chapter arc over the warp-feedback tunnel).

Human notes in play (on tunnel-class siblings, g08-tunnel-beat /
g09-tunnel-chroma): "there is a bug in tunnel class--outer ring is smaller
than viewport, so i can sometimes see past edges of rectangle to the black
bg", "could be a little less white", plus the family-wide "more dynamic in
color" wish.

Falsifiable question: with the viewport seam gone, the whites reined in,
and the ring carrying a flowing multi-hue sweep, does saga read as a
finished preset rather than a promising draft?

Instruction: copy g04-tunnel-saga; keep the chapter engine untouched. Three
execution fixes:
1. FULLBLEED (the class bug): when warping the previous frame in, the
   rotated rectangle exposes its corners — scale the feedback draw by the
   exact cover factor cos|θ| + (W/H)·sin|θ| (θ = this frame's rotation) so
   the buffer always covers the viewport. No visible border, ever.
2. LESS WHITE: cap ring lightness ~72% (was 85), sparkles ~65% (was 75),
   punch inner ring ~68% — saturation stays 100%; the hue does the work.
3. CONIC RING FLOW: the tunnel-mouth ring is stroked in 10 segments, each
   offset along a ~70° hue span that slowly rotates around the mouth (flow
   rate rides bandsSlow.mid — motion smoothness law). The smeared tunnel
   walls inherit the multi-hue sweep: no more monochrome throat.

Invariants: chapter arc (dream 1-8, climb 9-15, punch 16, drop override,
buildup acceleration) byte-identical; kick lunge on impulse.low; localized
ring pulses only (photosafe); trail/zoom endpoints unchanged.

Degrees of freedom (params): parent's dreamTrail/punchZoom + hue span
(conic width).

Assigned tech: bandsSlow (flow + travel rates, inherited), per-band
impulses (lunge/spin/sparks), trend drop-buildup split (chapter override),
beat.barIndex section arc, energy trend.

Anti-resemblance: no quantized cuts (that is g14-tunnel-verses' job); no
new particle species (g12-tunnel-swarm owns fireflies).

Contract: default-export VisualizerPreset; Canvas 2D renderer; frame
fields: bands/impulse/trend/beat/params/time/dt. Hard rules: self-contained
file; photosensitivity floor; bright saturated colors.
File: g14-saga-fullbleed.candidate.ts.
