/**
 * g06-tectonic (NOVEL — sol-review concept "Tectonic Mix").
 *
 * A LATERAL two-deck stage, NOT a centered scene. Two deck-owned
 * continental plates meet at a VERTICAL SEAM whose x-position is driven by
 * the crossfader (left group A/C vs right group B/D). Each audible plate
 * contributes:
 *   - a saturated TRAVELING color field (per-side hue, drifting laterally),
 *   - a spectrum-shaped COASTLINE where band identity is carried by terrain
 *     SCALE: low band raises solid landmass (broad swells), mids buckle
 *     ridges (medium folds), highs etch fine faults (high-frequency detail).
 *
 * Interaction contract (invariants):
 *   - seam x  <- crossfader (deck-group level balance / fader).
 *   - band identity = terrain SCALE (low mass / mid ridge / high fault),
 *     never hue.
 *   - fader movement advances one plate OVER the other (overthrust at the
 *     seam: the advancing plate's crust rides up on the retreating one).
 *   - EQ kills erase the matching scale of terrain on that side (kill low =
 *     landmass collapses; kill high = faults smooth out).
 *   - doubles interlock strata (same track both sides = laterally-locked,
 *     meshing folds across the seam).
 *   - kicks drive a localized horizontal COMPRESSION wave through the
 *     audible plate (solid, low-gated).
 *   - snares crack GLOWING FISSURES along existing faults (mid/high-gated
 *     light IN the cracks — not dust).
 *   - buildup: fault closes, vivid pressure veins rise (never dimmer).
 *   - drop: RUPTURE — plates separate, a bright rift opens at the seam,
 *     sustained on max(drop, energy). Displacement + color travel +
 *     localized edge light — NEVER a full-field flash.
 *   - section boundaries rotate the collision axis / switch regime
 *     (0 subduction, 1 rift, 2 transform) via ladderBarIndex ?? barIndex.
 *
 * Anti-resemblance held: no centered radial glow, no feedback-warp tunnel,
 * no cosine-palette default. This is a heightfield-shaded lateral stage.
 * No feedback buffer — a clean per-frame heightfield render, so there is no
 * tunnel skin and no trail smear.
 */

import type { UniformValue } from '../glPreset';
import { createGlRenderer } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_seam;        // seam x in 0..1 (from crossfader)
uniform float u_axis;        // collision axis rotation (radians, per section)
uniform float u_regime;      // 0 subduction, 1 rift, 2 transform
uniform float u_advance;     // -1 left plate advances .. +1 right advances
uniform float u_rupture;     // 0 closed .. 1 fully separated (drop)
uniform float u_buildup;     // pre-drop tension (veins rise)
uniform float u_energy;      // overall loudness floor for sustained motion

// Per-side (L = left plate, R = right plate) audible state.
uniform float u_lLevel;
uniform float u_rLevel;
uniform float u_lLow;   uniform float u_lMid;   uniform float u_lHigh;
uniform float u_rLow;   uniform float u_rMid;   uniform float u_rHigh;
uniform float u_lKill;  // (unused hue) reserved
uniform vec3 u_lHue;    // left traveling field hue (chroma-true)
uniform vec3 u_rHue;    // right traveling field hue
uniform float u_lTravel; // left field lateral travel phase
uniform float u_rTravel; // right field lateral travel phase
uniform float u_doubles; // 0..1 strata interlock strength

// Kick compression wave (per side).
uniform float u_lComp;   // left compression amp
uniform float u_lCompX;  // left wave front x (0..1, from seam outward)
uniform float u_rComp;
uniform float u_rCompX;

// Snare fissure light (per side, mid/high gated).
uniform float u_lFissure;
uniform float u_rFissure;

uniform float u_seed;

const float PI = 3.141592653589793;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(11.3, 5.9);
    amp *= 0.5;
  }
  return v;
}

// Ridged noise — sharp crests for mid-scale buckling ridges.
float ridged(vec2 p) {
  return 1.0 - abs(noise(p) * 2.0 - 1.0);
}

// Terrain COASTLINE height for one plate at horizontal coordinate s
// (0 at the seam .. 1 at that plate's frame edge). Band identity carried by
// SCALE: low -> broad landmass swells, mid -> ridges, high -> fine faults.
// EQ kills arrive already folded into (low,mid,high). Returns crust height.
float coast(float s, float lowB, float midB, float highB,
            float travel, float doubles, float t) {
  // Interlocking strata phase: same-track doubles lock the fold phase so the
  // two plates mesh (shared travel term) instead of drifting independently.
  float lock = mix(travel, t * 0.15, 0.0);
  // Low: solid landmass — a few broad swells rising from the interior.
  float mass = lowB * (0.55 + 0.45 * fbm(vec2(s * 2.0 + lock * 0.3, u_seed)));
  // Mid: buckled ridges — medium-frequency crests, doubles interlace them.
  float ridge = midB * ridged(vec2(s * 7.0 - travel * 0.6 + doubles * 3.0, u_seed * 1.7))
              * (0.6 + 0.4 * doubles);
  // High: fine faults — high-frequency etch, sharp thin notches.
  float fault = highB * fbm(vec2(s * 34.0 + travel * 1.4, u_seed * 2.3 + 4.0)) * 0.6;
  return mass * 0.5 + ridge * 0.28 + fault * 0.18;
}

// Fault-line field: where the crust is steep in the high-scale terrain, the
// snare-lit fissures live. Returns 0..1 crack proximity for glow siting.
float faultLines(float s, float y, float highB, float travel) {
  float n = fbm(vec2(s * 20.0 + travel, y * 24.0 + 2.0));
  float lines = 1.0 - smoothstep(0.0, 0.06 + 0.5 * highB, abs(n - 0.5));
  return lines;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;

  // Rotate the collision axis about frame center (section regime rotates it).
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float ca = cos(u_axis);
  float sa = sin(u_axis);
  vec2 rc = mat2(ca, -sa, sa, ca) * c;
  // Back to a 0..1 axis coordinate for the lateral stage.
  vec2 p = rc / vec2(aspect, 1.0) + 0.5;
  float x = p.x;
  float y = p.y;

  // ---- Seam. Crossfader sets its x; rupture opens a rift gap around it.
  float seam = u_seam;
  float rift = u_rupture * (0.06 + 0.10 * u_energy); // half-width of the gap
  // Overthrust: the advancing plate shoves the seam laterally (fader moves
  // one plate over the other) — a displacement, not a flash.
  float thrust = u_advance * (0.02 + 0.05 * max(u_lLevel, u_rLevel));

  // Which plate does this pixel belong to (with rift gap between)?
  float dxL = (seam - thrust) - rift - x;   // >0 => left of left-edge
  float dxR = x - ((seam - thrust) + rift);  // >0 => right of right-edge
  float sideR = step(0.5, x - (seam - thrust)); // 0 left, 1 right (for tint)

  // Per-plate interior coordinate s: 0 at seam edge -> 1 at frame edge.
  float sL = clamp(((seam - thrust) - rift - x) / max(seam - rift, 0.02), 0.0, 1.0);
  float sR = clamp((x - ((seam - thrust) + rift)) / max(1.0 - seam - rift, 0.02), 0.0, 1.0);

  // ---- Coastline heights per plate.
  float hL = coast(sL, u_lLow, u_lMid, u_lHigh, u_lTravel, u_doubles, u_time);
  float hR = coast(sR, u_rLow, u_rMid, u_rHigh, u_rTravel, u_doubles, u_time);

  // Kick compression wave: a horizontal pressure front sweeping the plate
  // interior, raising the crust as it passes (solid, low-gated).
  float compL = exp(-pow((sL - u_lCompX) * 9.0, 2.0)) * u_lComp;
  float compR = exp(-pow((sR - u_rCompX) * 9.0, 2.0)) * u_rComp;
  hL += compL * 0.16;
  hR += compR * 0.16;

  // Buildup pressure veins: the fault closes and vivid veins bulge up
  // (never dimmer) — a rising displacement across both plates.
  float veinL = u_buildup * (0.06 + 0.06 * u_lLevel) * ridged(vec2(sL * 12.0 + u_time * 0.5, 3.0));
  float veinR = u_buildup * (0.06 + 0.06 * u_rLevel) * ridged(vec2(sR * 12.0 + u_time * 0.5, 7.0));
  hL += veinL;
  hR += veinR;

  // ---- Heightfield shading. The crust surface is at height h from the
  // baseline; the plate occupies y below (surfLine) so it reads as landmass
  // rising from a lowland. Coastline = surface height as a y threshold.
  float baseL = 0.12 + 0.55 * hL;   // left crust top (0..1 y)
  float baseR = 0.12 + 0.55 * hR;
  // Belongs to left/right plate mask (rift gap dark between plates).
  float inL = step(x, (seam - thrust) - rift);
  float inR = step((seam - thrust) + rift, x);

  // Solid landmass fill below the coastline, shaded by slope (fake normal).
  float slopeL = (coast(sL + 0.01, u_lLow, u_lMid, u_lHigh, u_lTravel, u_doubles, u_time) - hL) * 40.0;
  float slopeR = (coast(sR + 0.01, u_rLow, u_rMid, u_rHigh, u_rTravel, u_doubles, u_time) - hR) * 40.0;
  float shadeL = clamp(0.55 - slopeL * 0.5, 0.15, 1.0);
  float shadeR = clamp(0.55 + slopeR * 0.5, 0.15, 1.0);

  float landL = smoothstep(baseL + 0.008, baseL - 0.008, y) * inL;
  float landR = smoothstep(baseR + 0.008, baseR - 0.008, y) * inR;

  // Coastline rim (bright edge line of the crust top).
  float rimL = exp(-pow((y - baseL) * 90.0, 2.0)) * inL;
  float rimR = exp(-pow((y - baseR) * 90.0, 2.0)) * inR;

  // ---- Traveling saturated color fields. Hue is FREE to travel laterally;
  // shape (above) carried the band identity.
  float travTintL = 0.5 + 0.5 * sin(sL * 6.0 - u_lTravel * 2.0 + y * 3.0);
  float travTintR = 0.5 + 0.5 * sin(sR * 6.0 - u_rTravel * 2.0 + y * 3.0);
  vec3 fieldL = u_lHue * (0.55 + 0.6 * travTintL);
  vec3 fieldR = u_rHue * (0.55 + 0.6 * travTintR);

  vec3 col = vec3(0.0);
  // Lowland base glow (deep, never black interior — keeps the stage alive).
  col += fieldL * inL * (0.05 + 0.12 * u_lLevel) * (1.0 - landL);
  col += fieldR * inR * (0.05 + 0.12 * u_rLevel) * (1.0 - landR);
  // Solid crust.
  col += fieldL * landL * shadeL * (0.7 + 1.1 * u_lLevel);
  col += fieldR * landR * shadeR * (0.7 + 1.1 * u_rLevel);
  // Coastline rim light (lifts with kicks/compression).
  col += mix(fieldL, vec3(1.0), 0.35) * rimL * (0.6 + 1.4 * compL + 0.8 * u_lLevel);
  col += mix(fieldR, vec3(1.0), 0.35) * rimR * (0.6 + 1.4 * compR + 0.8 * u_rLevel);

  // ---- Snare GLOWING FISSURES: mid/high-gated light etched INTO the faults
  // of the crust (localized edge light, not a field flash).
  float flL = faultLines(sL, y, u_lHigh, u_lTravel) * landL;
  float flR = faultLines(sR, y, u_rHigh, u_rTravel) * landR;
  col += mix(u_lHue, vec3(1.0), 0.5) * flL * u_lFissure * 2.2;
  col += mix(u_rHue, vec3(1.0), 0.5) * flR * u_rFissure * 2.2;

  // ---- Rift (drop): a bright vertical rift opens at the seam, its walls
  // glowing with both plates' hues as they separate. Localized band along x,
  // sustained on max(drop, energy) via u_rupture. NOT a full-field flash.
  float seamDist = abs(x - (seam - thrust));
  float riftGlow = exp(-pow((seamDist - rift) * 26.0, 2.0)) * u_rupture;
  vec3 riftCol = mix(u_lHue, u_rHue, sideR);
  riftCol = mix(riftCol, vec3(1.0), 0.4);
  // Deep fresh magma in the gap floor + hot walls.
  float inGap = 1.0 - smoothstep(rift * 0.6, rift, seamDist);
  col += riftCol * (riftGlow * 1.6 + inGap * u_rupture * (0.5 + 0.8 * u_energy));

  // ---- Seam seam-line when closed (subduction/transform): a thin bright
  // suture where the plates meet, pulsed by whichever side is louder.
  float suture = exp(-pow(seamDist * 120.0, 2.0)) * (1.0 - u_rupture);
  col += mix(u_lHue, u_rHue, 0.5) * suture * (0.4 + 1.0 * max(u_lLevel, u_rLevel));

  // Transform-regime shear streaks along the seam (regime==2): horizontal
  // striping that slides oppositely on each side.
  float shear = smoothstep(1.5, 2.0, u_regime);
  float streak = sin(y * 60.0 + (sideR > 0.5 ? -1.0 : 1.0) * u_time * 6.0) * 0.5 + 0.5;
  col += mix(u_lHue, u_rHue, sideR) * shear * streak
       * exp(-seamDist * 6.0) * 0.4 * max(u_lLevel, u_rLevel);

  // Solid whole-plate kick punch (subtle, localized to the audible side).
  col *= 1.0 + 0.08 * (compL + compR);

  // ---- Chroma-preserving soft knee (never per-channel clamp).
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

type Rgb = [number, number, number];

/** HSL (h 0..360, s/l 0..1) → chroma-true rgb 0..1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

/** EQ knob → band gain. 0.5 flat = 1.0; 0 kill = 0; 1 boost ~1.6. A kill
 * deletes that scale of terrain on the plate. */
function eqGate(knob: number): number {
  return Math.max(0, Math.min(1.6, (knob - 0.5) * 2 + 1));
}

const SECTION_BARS = 16;

interface PlateAgg {
  level: number;
  low: number;
  mid: number;
  high: number;
  hue: number;
  travel: number;
  comp: number;
  compX: number;
  fissure: number;
  trackId: number | null;
}

export const g06TectonicPreset: VisualizerPreset = {
  id: 'g06-tectonic',
  name: 'g06 tectonic',
  hiRes: true,
  params: [
    { id: 'relief', label: 'terrain relief', min: 0.3, max: 2, step: 0.05, default: 1 },
    { id: 'travel', label: 'color travel', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'rupture', label: 'rupture drive', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'seamGain', label: 'crossfader throw', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;

    // Smoothed per-side aggregates (avoid pops on deck switches).
    const L: PlateAgg = { level: 0, low: 0, mid: 0, high: 0, hue: 200, travel: 0, comp: 0, compX: 0.1, fissure: 0, trackId: null };
    const R: PlateAgg = { level: 0, low: 0, mid: 0, high: 0, hue: 330, travel: 0, comp: 0, compX: 0.1, fissure: 0, trackId: null };

    let seam = 0.5;
    let advance = 0;
    let prevSeamTarget = 0.5;

    // Drop / rupture genome.
    let smoothDrop = 0;
    let prevDrop = 0;
    let rupture = 0;
    let smoothBuildup = 0;

    // Section regime + collision axis.
    let regime = 0;
    let axisTarget = 0;
    let axis = 0;
    let lastSection = -1;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: false,
      uniforms: (frame: VisualizerFrameData): Record<string, UniformValue> => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const a = 1 - Math.exp(-dt / 0.2);

        const relief = frame.params.relief ?? 1;
        const travelGain = frame.params.travel ?? 1;
        const ruptureGain = frame.params.rupture ?? 1;
        const seamGain = frame.params.seamGain ?? 1;

        // ---- Split decks into left (A/C) and right (B/D) plate groups,
        // level-weighted. EQ-gate each side's band terrain. Fader/level
        // balance drives the seam.
        let lLevel = 0;
        let rLevel = 0;
        let lLowW = 0, lMidW = 0, lHighW = 0, lFaderW = 0;
        let rLowW = 0, rMidW = 0, rHighW = 0, rFaderW = 0;
        let lTop: (typeof frame.decks)[number] | null = null;
        let rTop: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (!d.playing || d.level <= 0.001) continue;
          const left = d.channel === 'A' || d.channel === 'C';
          if (left) {
            lLevel += d.level;
            lLowW += d.level * eqGate(d.eq.low);
            lMidW += d.level * eqGate(d.eq.mid);
            lHighW += d.level * eqGate(d.eq.high);
            lFaderW += d.level * d.fader;
            if (lTop === null || d.level > lTop.level) lTop = d;
          } else {
            rLevel += d.level;
            rLowW += d.level * eqGate(d.eq.low);
            rMidW += d.level * eqGate(d.eq.mid);
            rHighW += d.level * eqGate(d.eq.high);
            rFaderW += d.level * d.fader;
            if (rTop === null || d.level > rTop.level) rTop = d;
          }
        }
        lLevel = Math.min(1, lLevel);
        rLevel = Math.min(1, rLevel);

        // Per-side terrain = shared band spectrum shaped by that side's EQ
        // gate, scaled by that side's audible level.
        const bl = frame.bands.low;
        const bm = frame.bands.mid;
        const bh = frame.bands.high;
        const lLow = lLevel > 0 ? (lLowW / Math.max(lLevel, 0.001)) * bl * lLevel : 0;
        const lMid = lLevel > 0 ? (lMidW / Math.max(lLevel, 0.001)) * bm * lLevel : 0;
        const lHigh = lLevel > 0 ? (lHighW / Math.max(lLevel, 0.001)) * bh * lLevel : 0;
        const rLow = rLevel > 0 ? (rLowW / Math.max(rLevel, 0.001)) * bl * rLevel : 0;
        const rMid = rLevel > 0 ? (rMidW / Math.max(rLevel, 0.001)) * bm * rLevel : 0;
        const rHigh = rLevel > 0 ? (rHighW / Math.max(rLevel, 0.001)) * bh * rLevel : 0;

        // Smooth aggregates.
        L.level += (lLevel - L.level) * a;
        R.level += (rLevel - R.level) * a;
        L.low += (lLow * relief - L.low) * a;
        L.mid += (lMid * relief - L.mid) * a;
        L.high += (lHigh * relief - L.high) * a;
        R.low += (rLow * relief - R.low) * a;
        R.mid += (rMid * relief - R.mid) * a;
        R.high += (rHigh * relief - R.high) * a;
        L.trackId = lTop?.trackId ?? null;
        R.trackId = rTop?.trackId ?? null;

        // ---- Seam x from the crossfader: the group fader positions AND the
        // level balance. fader is 0..1 (0 = full toward its own side). We map
        // the audible balance to a seam in [0.12, 0.88].
        const total = lLevel + rLevel + 0.001;
        const balance = rLevel / total; // 0 all-left … 1 all-right
        // Fader nudge: if a side's decks are faded toward center the seam
        // biases that way.
        const faderBias = (lFaderW - rFaderW) / (lLevel + rLevel + 0.001);
        const seamTarget = Math.max(
          0.12,
          Math.min(0.88, 0.5 + (balance - 0.5) * 0.9 * seamGain + faderBias * 0.15)
        );
        // Advance sign: which way the seam is currently traveling = which
        // plate is riding over the other.
        const seamVel = (seamTarget - prevSeamTarget) / Math.max(dt, 1e-3);
        prevSeamTarget = seamTarget;
        advance += (Math.max(-1, Math.min(1, seamVel * 2.5)) - advance) * (1 - Math.exp(-dt / 0.25));
        seam += (seamTarget - seam) * (1 - Math.exp(-dt / 0.4));

        // ---- Doubles: same track audible on both sides interlocks strata.
        const doubles =
          L.trackId !== null && R.trackId !== null && L.trackId === R.trackId ? 1 : 0;

        // ---- Traveling color fields (hue free to travel; chroma-true).
        L.travel += dt * travelGain * (0.4 + 1.2 * L.level + 0.6 * L.mid);
        R.travel += dt * travelGain * (0.4 + 1.2 * R.level + 0.6 * R.mid);
        // Left plate cool→warm sweep, right plate offset ~150° — saturated.
        L.hue = (200 + frame.time * 8 + L.travel * 6) % 360;
        R.hue = (200 + 150 + frame.time * 8 + R.travel * 6) % 360;
        const lHue = hslToRgb(L.hue, 1, 0.52 + 0.1 * L.low);
        const rHue = hslToRgb(R.hue, 1, 0.52 + 0.1 * R.low);

        // ---- Kick compression waves (solid, low-gated) per audible side.
        L.compX += dt * 1.4;
        R.compX += dt * 1.4;
        if (frame.impulse.low > 0.3) {
          if (L.level >= R.level && L.level > 0.02) {
            L.compX = 0.02;
            L.comp = Math.min(1, frame.impulse.low * 1.3);
          }
          if (R.level >= L.level && R.level > 0.02) {
            R.compX = 0.02;
            R.comp = Math.min(1, frame.impulse.low * 1.3);
          }
        }
        L.comp = Math.max(0, L.comp - dt * 2.0);
        R.comp = Math.max(0, R.comp - dt * 2.0);

        // ---- Snare fissures: mid/high-gated light along faults per side.
        const snareGate = Math.min(1, frame.impulse.mid * 1.4);
        L.fissure += ((snareGate * (0.4 + 0.6 * L.high) * (L.level > 0.02 ? 1 : 0)) - L.fissure) * (1 - Math.exp(-dt / 0.12));
        R.fissure += ((snareGate * (0.4 + 0.6 * R.high) * (R.level > 0.02 ? 1 : 0)) - R.fissure) * (1 - Math.exp(-dt / 0.12));

        // ---- Drop / buildup split (voyage idiom); rupture rides
        // max(drop, energy). No trend.drop field — derived here.
        const energy = Math.min(1, frame.bands.low * 0.5 + frame.bands.mid * 0.3 + frame.bands.high * 0.2);
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * (1 - Math.exp(-dt / 0.35));
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * (1 - Math.exp(-dt / 0.35));
        prevDrop = smoothDrop;
        void prevDrop;
        const dropRide = Math.max(smoothDrop, energy);
        // Rupture opens on a drop, sustained on max(drop, energy).
        const ruptureAim = Math.min(1, smoothDrop * 1.2) * (0.5 + 0.5 * dropRide) * ruptureGain;
        rupture += (ruptureAim - rupture) * (1 - Math.exp(-dt / 0.4));

        // ---- Section boundary: rotate collision axis / switch regime.
        if (frame.beat) {
          const barIndex = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          const section = Math.floor(barIndex / SECTION_BARS);
          if (section !== lastSection && lastSection >= 0) {
            regime = (regime + 1) % 3;
            // subduction=flat axis, rift=slight tilt, transform=steeper.
            axisTarget = (regime === 0 ? 0 : regime === 1 ? 0.12 : -0.22);
          }
          lastSection = section;
        }
        axis += (axisTarget - axis) * (1 - Math.exp(-dt / 1.2));

        return {
          u_time: frame.time,
          u_seam: seam,
          u_axis: axis,
          u_regime: regime,
          u_advance: advance,
          u_rupture: Math.max(0, Math.min(1, rupture)),
          u_buildup: Math.max(0, Math.min(1, smoothBuildup)),
          u_energy: energy,
          u_lLevel: L.level,
          u_rLevel: R.level,
          u_lLow: Math.min(1.6, L.low),
          u_lMid: Math.min(1.6, L.mid),
          u_lHigh: Math.min(1.6, L.high),
          u_rLow: Math.min(1.6, R.low),
          u_rMid: Math.min(1.6, R.mid),
          u_rHigh: Math.min(1.6, R.high),
          u_lKill: 0,
          u_lHue: [lHue[0], lHue[1], lHue[2]],
          u_rHue: [rHue[0], rHue[1], rHue[2]],
          u_lTravel: L.travel,
          u_rTravel: R.travel,
          u_doubles: doubles,
          u_lComp: L.comp,
          u_lCompX: L.compX,
          u_rComp: R.comp,
          u_rCompX: R.compX,
          u_lFissure: L.fissure,
          u_rFissure: R.fissure,
          u_seed: 3.7,
        };
      },
    });
  },
};

export default g06TectonicPreset;
