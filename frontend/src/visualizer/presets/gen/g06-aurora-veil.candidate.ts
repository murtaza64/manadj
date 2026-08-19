/**
 * g06-aurora-veil (gen-6 novel): a clean-room remake of the dead g00-aurora
 * under the concept-vs-execution rule. g00-aurora died WASHY, STATIC and
 * UNRESPONSIVE — full-screen fbm veils where every band moved together,
 * excitement just raised whole-sky brightness, nothing was beat-causal.
 *
 * The fix is STRUCTURE FIRST: nimitz-style layered sine-ridge curtains
 * (ridged sines + triangle noise, 3-5 octaves) that are legible, band-
 * OWNED, and beat-CAUSAL. Curtains hang DIAGONALLY across an OFF-CENTER
 * sky over a dark horizon silhouette (scale). No dust, no radial layout,
 * no full-field wash.
 *
 * Band identity by SHAPE:
 * - LOW = one deep slow curtain whose HEM slams brighter and ripples
 *   outward on kicks (voyage traveling-ripple idiom, run LATERALLY along
 *   the hem — a solid light front sweeping the curtain base).
 * - MID = the main dancing curtains (fold depth + dance speed from mids).
 * - HIGH = fine corona RAYS + shimmer racing along the curtain TOPS
 *   (never particles).
 *
 * Color: each curtain samples a traveling palette with wide phase span;
 * phrase (`ladderBarIndex ?? barIndex`) advances the palette SEASON.
 * Section boundary = magnetic SUBSTORM: curtains collapse poleward and
 * re-form in a new palette regime + new diagonal (drastic, chromatic,
 * sub-second sweep — NOT a full-field flash). No feedback buffer: the
 * curtains are computed fresh, so there is nothing to smear washy.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import type { BandLevels, EnergyTrend } from '../../bands';
import type { BeatInfo } from '../../channel';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;   // shimmer / ray hue bias
uniform float u_spread;     // curtain palette breadth
uniform float u_drop;       // bass-weighted smoothed drop
uniform float u_sustain;    // sustained loudness (ride the plateau)
uniform float u_buildup;    // excitement without bass (tighten curtains)
uniform float u_season;     // palette season, advances on phrase
uniform float u_regime;     // palette regime, advances on substorm
uniform float u_regimeMix;  // 0..1 crossfade old->new regime
uniform float u_diagonal;   // curtain diagonal slope (changes on substorm)
uniform float u_prevDiagonal;
uniform float u_substorm;   // substorm strength (poleward collapse)
uniform float u_hemAge;     // seconds since last kick (hem ripple front)
uniform float u_hemAmp;     // that kick's captured strength
uniform float u_curtains;   // param: curtain count/detail
uniform float u_rays;       // param: corona ray gain
uniform float u_speed;      // param: dance speed
uniform float u_horizon;    // param: horizon silhouette height

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float hash1(float x) { return fract(sin(x * 91.3458) * 47453.5453); }

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

// nimitz triangle noise — the aurora technique for crisp ridges.
float tri(float x) { return abs(fract(x) - 0.5); }

// Layered ridged-sine + triangle-noise curtain field: returns a horizontal
// displacement (the fold pattern) for a given x, phase, octaves of detail.
float curtainFold(float x, float t, float speed, float detail) {
  float f = 0.0;
  float amp = 1.0;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) > detail) break;
    f += amp * sin(x * freq + t * speed * (0.6 + 0.3 * float(i)));
    f += amp * 0.7 * (tri(x * freq * 0.7 - t * speed * 0.4) - 0.25);
    amp *= 0.55;
    freq *= 1.9;
  }
  return f;
}

// Two saturated aurora palette regimes; substorm crossfades between them.
// Wide phase span so curtains TRAVEL in color (not a flat wash).
vec3 palRegime(float s, float r) {
  float k = mod(r, 4.0);
  vec3 a, b, c, d;
  if (k < 1.0) {          // classic green / cyan
    a = vec3(0.05, 0.30, 0.20); b = vec3(0.20, 0.50, 0.35);
    c = vec3(0.80, 1.00, 0.90); d = vec3(0.10, 0.35, 0.55);
  } else if (k < 2.0) {   // magenta / crimson storm
    a = vec3(0.35, 0.08, 0.30); b = vec3(0.45, 0.20, 0.35);
    c = vec3(1.00, 0.80, 0.75); d = vec3(0.00, 0.20, 0.50);
  } else if (k < 3.0) {   // violet / electric blue
    a = vec3(0.20, 0.15, 0.45); b = vec3(0.30, 0.30, 0.55);
    c = vec3(0.85, 0.90, 1.00); d = vec3(0.15, 0.30, 0.60);
  } else {                // gold / teal
    a = vec3(0.30, 0.30, 0.12); b = vec3(0.40, 0.45, 0.30);
    c = vec3(0.90, 1.00, 0.70); d = vec3(0.10, 0.25, 0.50);
  }
  return a + b * cos(6.28318 * (c * s + d));
}

vec3 palette(float s) {
  vec3 oldC = palRegime(s, u_regime - 1.0);
  vec3 newC = palRegime(s, u_regime);
  return mix(oldC, newC, clamp(u_regimeMix, 0.0, 1.0));
}

// Corona rays / shimmer color: iridescent, biased by centroid.
vec3 iridescent(float phase) {
  return 0.55 + 0.45 * cos(6.28318 * (phase + vec3(0.0, 0.33, 0.66)));
}

// One curtain system. id seeds its diagonal offset + drift. Returns
// emitted color contribution. band is its owning level; role picks
// hem(0)/dance(1)/ray(2) behaviour.
vec3 curtainSystem(
  vec2 uv, float aspect, float t, float id, float band,
  float speed, float detail, float baseSeason
) {
  // Diagonal hang: shear x by a slope that changes on substorm (crossfade
  // old->new diagonal so it SWEEPS to a new angle).
  float slope = mix(u_prevDiagonal, u_diagonal, clamp(u_regimeMix, 0.0, 1.0));
  float sx = uv.x + (uv.y - 0.5) * (slope + 0.3 * sin(id * 2.3));
  float dx = sx * aspect * (2.5 + 3.0 * u_curtains) + id * 17.0;

  // Fold pattern -> the curtain's horizontal centerline at this height.
  float fold = curtainFold(dx, t, speed, detail);
  // Fold DEPTH rides mids; buildup TIGHTENS (narrower, sharper folds).
  float depth = (0.10 + 0.35 * band) / (1.0 + 1.2 * u_buildup);
  float center = 0.5 + fold * depth;

  // Vertical body: bright at top, falling to the hem. reach = how high the
  // curtain hangs, driven by the band (quiet band = short veil).
  float across = abs(sx - center);
  float body = 1.0 - smoothstep(0.0, 0.06 + 0.10 * (1.0 - band), across);

  // Vertical falloff: curtains hang from the top of the off-center sky.
  float top = smoothstep(0.05, 0.95, uv.y);
  float veil = body * top;
  veil = pow(max(0.0, veil), 1.5);

  vec3 col = vec3(0.0);
  // Base curtain color travels with season + height (wide phase span).
  float season = baseSeason + uv.y * (0.4 + 0.6 * u_spread) + id * 0.2
    + u_centroid * 0.25;
  vec3 curtainColor = palette(season);
  col += curtainColor * veil * (0.15 + 1.3 * band + 0.5 * u_sustain);

  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float t = u_time * u_speed;

  // Substorm poleward collapse: curtains lift toward the top and thin out
  // as the storm peaks, then re-form. Applied as a vertical remap.
  float collapse = u_substorm;
  vec2 suv = uv;
  suv.y = mix(uv.y, 1.0 - (1.0 - uv.y) * (1.0 - 0.6 * collapse), collapse);

  vec3 col = vec3(0.0);

  // ---- LOW curtain: a deep slow curtain, low and wide. Its HEM slams and
  // ripples on kicks (the voyage ripple idiom, lateral along the hem).
  col += curtainSystem(suv, aspect, t, 1.0, u_low, 0.5, 2.0, u_season)
    * (0.6 + 0.8 * u_low);
  // Hem: a bright light front sweeping LATERALLY along the curtain base.
  {
    float hemY = 0.12 + 0.05 * u_low;
    float hemBand = exp(-abs(suv.y - hemY) * 14.0);
    // Traveling lateral front: a bright band sweeping across x from a kick.
    float frontX = -0.2 + u_hemAge * 1.6;
    float front = exp(-pow((suv.x - frontX) * 5.0, 2.0)) * exp(-u_hemAge * 2.0) * u_hemAmp;
    float slam = hemBand * (0.15 + 0.9 * u_kick + 1.4 * front);
    col += mix(LOW, palette(u_season + 0.1), 0.5) * slam * (0.6 + 0.7 * u_low);
  }

  // ---- MID curtains: two main dancing curtains (dance speed + fold depth
  // from mids). Off-center: different id offsets place them off-axis.
  col += curtainSystem(suv, aspect, t * 1.3, 2.4, u_mid, 1.0 + 1.5 * u_mid, 3.0, u_season + 0.25)
    * (0.4 + 1.0 * u_mid);
  col += curtainSystem(suv, aspect, t * 1.6, 4.1, u_mid, 1.2 + 1.8 * u_mid, 3.0, u_season + 0.5)
    * (0.3 + 0.9 * u_mid);

  // ---- HIGH: fine corona RAYS + shimmer racing along the curtain TOPS.
  // Vertical rays (aurora corona) whose brightness runs with highs; they
  // are structure, not particles.
  {
    float slope = mix(u_prevDiagonal, u_diagonal, clamp(u_regimeMix, 0.0, 1.0));
    float sx = suv.x + (suv.y - 0.5) * slope;
    float rayField = 0.0;
    float freq = 60.0 + 120.0 * u_curtains;
    // ridged high-frequency vertical rays, top-weighted.
    float rr = tri(sx * aspect * freq + u_centroid * 4.0 + t * 0.3);
    rayField = 1.0 - smoothstep(0.0, 0.02, rr);
    float rayTop = smoothstep(0.35, 1.0, suv.y);
    float shimmer = 0.5 + 0.5 * sin(t * 14.0 + sx * 200.0);
    vec3 rayColor = iridescent(u_centroid + t * 0.2 + suv.y * 0.5);
    col += rayColor * rayField * rayTop * shimmer * u_rays * (0.05 + 1.8 * u_high);
  }

  // ---- Substorm chromatic flare: a colored poleward glow at the peak
  // (chromatic, top-weighted — NOT a full-field luminance flash).
  if (u_substorm > 0.001) {
    float pole = smoothstep(0.3, 1.0, suv.y) * u_substorm;
    vec3 stormHue = palette(0.5 + suv.y * 0.5 + t * 0.05);
    col += stormHue * pole * 0.5;
  }

  // ---- Dark horizon silhouette (scale): a low ragged ridge at the bottom,
  // near-black, occluding the sky below it.
  float ridge = u_horizon * (0.05 + 0.03 * noise(vec2(uv.x * 6.0, 3.0))
    + 0.015 * noise(vec2(uv.x * 20.0, 9.0)));
  float land = smoothstep(ridge + 0.008, ridge - 0.008, uv.y);
  // A faint rim-light on the ridge crest from the low curtain.
  float crest = exp(-abs(uv.y - ridge) * 60.0);
  vec3 rimGlow = mix(LOW, palette(u_season), 0.5) * crest * (0.1 + 0.5 * u_low) * (1.0 - land);
  col = mix(col, vec3(0.0), land);
  col += rimGlow;

  // Sky floor: a very dark saturated sky gradient (dark-sky floor, never
  // washy). Saturates upward on buildup (sky saturates upward).
  vec3 skyFloor = palette(0.1 + uv.y * 0.3) * (0.02 + 0.04 * uv.y)
    * (1.0 + 0.6 * u_buildup) * (1.0 - land);
  col += skyFloor;

  // Buildup tension: overall slightly dimmed but rays/curtains sharpen;
  // drop/sustain bloom. Never eerily still.
  col *= 0.72 + 0.5 * max(u_drop, u_sustain) - 0.06 * u_buildup;

  // Snare: a brief ray-shimmer lift (mid transient), not particles.
  col += iridescent(u_centroid + 0.3) * u_snare * 0.12 * smoothstep(0.3, 1.0, uv.y) * (1.0 - land);

  // Photosensitivity + chroma-preserving soft knee (never per-channel).
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const candidate: VisualizerPreset = {
  id: 'g06-aurora-veil',
  name: 'g06 aurora-veil',
  hiRes: true,
  params: [
    { id: 'curtains', label: 'curtain detail', min: 0, max: 1.5, step: 0.05, default: 0.7 },
    { id: 'rays', label: 'corona rays', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'dance speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'horizon', label: 'horizon height', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let smoothSustain = 0;
    // Palette season advances per phrase; regime per substorm.
    let season = 0;
    let regime = 0;
    let regimeMix = 1;
    let diagonal = -0.35;
    let prevDiagonal = -0.35;
    // Substorm state.
    let substorm = 0;
    // Hem ripple (lateral traveling front).
    let hemAge = 999;
    let hemAmp = 0;
    // Tier tracking.
    let lastBarInPhrase = -1;
    let lastSection = -1;

    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const bands: BandLevels = frame.bands;
        const impulse: BandLevels = frame.impulse;
        const trend: EnergyTrend = frame.trend;
        const beat: BeatInfo | null = frame.beat;

        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(bands);

        // Bass-weighted smoothed drop (trend has no drop field); buildup =
        // excitement without bass; sustain rides the plateau.
        const lowPresence = Math.min(1, Math.max(0, (bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustainTarget = Math.min(1, energy * 1.4);
        smoothSustain += (sustainTarget - smoothSustain) * alpha;

        // Ladder tiers (fallback to barIndex).
        const barIndex = beat ? (beat.ladderBarIndex ?? beat.barIndex) : 0;
        const section = Math.floor(barIndex / 16);
        const barInPhrase = ((barIndex % 4) + 4) % 4;

        // PHRASE boundary: advance the palette season (subtle, per phrase).
        if (barInPhrase !== lastBarInPhrase) {
          if (barInPhrase === 0 && lastBarInPhrase !== -1) season += 0.17;
          lastBarInPhrase = barInPhrase;
        }

        // SECTION boundary -> SUBSTORM: collapse + recolor + new diagonal.
        if (section !== lastSection) {
          if (lastSection >= 0) {
            regime += 1;
            regimeMix = 0;
            substorm = 1;
            prevDiagonal = diagonal;
            // New diagonal: flip sign & vary magnitude for a clear angle change.
            const r = Math.sin(section * 12.9898) * 43758.5453;
            const frac = r - Math.floor(r);
            diagonal = (frac < 0.5 ? -1 : 1) * (0.25 + 0.35 * frac);
          }
          lastSection = section;
        }
        // Substorm: fast collapse, sub-second-scale re-form. regimeMix and
        // diagonal crossfade settle over ~0.9 s (chromatic sweep).
        regimeMix = Math.min(1, regimeMix + dt / 0.9);
        substorm = Math.max(0, substorm - dt / 1.1);

        // Hem lateral ripple: retrigger on strong kicks.
        hemAge += dt;
        if (impulse.low > 0.32 && hemAge > 0.12) {
          hemAge = 0;
          hemAmp = Math.min(1, impulse.low * 1.3);
        }

        return {
          u_time: frame.time,
          u_low: bands.low,
          u_mid: bands.mid,
          u_high: bands.high,
          u_kick: impulse.low,
          u_snare: impulse.mid,
          u_centroid: frame.centroid,
          u_spread: frame.spread,
          u_drop: smoothDrop,
          u_sustain: smoothSustain,
          u_buildup: smoothBuildup,
          u_season: season,
          u_regime: regime,
          u_regimeMix: regimeMix,
          u_diagonal: diagonal,
          u_prevDiagonal: prevDiagonal,
          u_substorm: substorm,
          u_hemAge: hemAge,
          u_hemAmp: hemAmp,
          u_curtains: frame.params.curtains ?? 0.7,
          u_rays: frame.params.rays ?? 1,
          u_speed: frame.params.speed ?? 1,
          u_horizon: frame.params.horizon ?? 1,
        };
      },
    });
  },
};

export default candidate;
