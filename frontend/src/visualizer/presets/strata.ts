/**
 * "Strata" preset (realtime-visualization 05): the Aurora variant where
 * each band gets its OWN representation instead of three copies of one —
 * the material is legible by shape, not just color:
 *
 *   low  → THE GROUND: a mountain silhouette whose mass is the bass
 *          level; kicks flare a magma ridge line and shake the rock
 *   mid  → THE VEIL: aurora curtains whose wave amplitude and reach ride
 *          the mids; snares ripple the fabric
 *   high → THE STARS: field density/twinkle from the highs; hat
 *          transients flare the whole field; a strong high hit launches
 *          a shooting star
 *
 * Waveform band colors throughout; drops (energy trend) lift the sky.
 */

import { ADDITIVE_COLORS } from '../../waveform/styles';
import { energyOf } from '../style';
import { createGlRenderer } from './glPreset';
import type { VisualizerPreset } from './types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

/** Shooting star flight time. */
const STREAK_S = 0.7;
/** High-impulse threshold that launches one. */
const STREAK_TRIGGER = 0.45;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_hat;
uniform float u_excite;
uniform float u_streak;      // shooting star progress 0..1 (>1 = none)
uniform float u_streakSeed;

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 MID = ${rgb(ADDITIVE_COLORS[1])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};

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
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// One parallax star layer: DRIFTING jittered stars with individual
// twinkle rates (fixed-grid stars read as a dead texture).
float starLayer(vec2 p, float density, float driftX, float t) {
  vec2 q = p * density + vec2(t * driftX, t * driftX * 0.13);
  vec2 cell = floor(q);
  vec2 pos = vec2(hash(cell + 1.3), hash(cell + 4.7)) * 0.8 + 0.1;
  vec2 f = fract(q) - pos;
  float star = exp(-dot(f, f) * 90.0);
  float gate = step(0.8, hash(cell + 9.3));
  float twinkle = 0.35 + 0.65 * (0.5 + 0.5 * sin(t * (2.0 + 5.0 * hash(cell + 2.2)) + hash(cell) * 40.0));
  return star * gate * twinkle;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = u_time;
  vec3 col = vec3(0.0);

  // ---- LOW: the ground. Mass = bass level; kicks shake and flare it.
  float shake = u_kick * 0.006 * sin(t * 60.0);
  float ridgeH = 0.08 + 0.24 * u_low;
  float ridge = ridgeH * (0.4 + 0.6 * fbm(vec2(p.x * 2.2 + 3.0, t * 0.03))) + shake;
  float ground = smoothstep(ridge + 0.003, ridge - 0.02, uv.y);
  vec3 rock = LOW * (0.12 + 0.25 * u_low) * (0.4 + 0.6 * (1.0 - uv.y / max(ridge, 1e-3)));
  col += rock * ground;
  // Glowing veins crack the rock, breathing with the bass.
  float vein = smoothstep(0.46, 0.5, fbm(p * 7.0 + vec2(0.0, t * 0.05)))
    * smoothstep(0.54, 0.5, fbm(p * 7.0 + vec2(0.0, t * 0.05)));
  col += mix(LOW, vec3(1.0, 0.6, 0.3), 0.5) * vein * ground * (0.25 + 0.8 * u_low + 1.2 * u_kick);
  // Magma ridge line, flaring on the kick.
  float ridgeLine = exp(-abs(uv.y - ridge) * 160.0);
  col += mix(LOW, vec3(1.0, 0.85, 0.6), 0.35 * u_kick) * ridgeLine * (0.3 + 1.5 * u_kick + 0.4 * u_low);
  // Embers: two layers of sparks rising off the ridge, thicker on kicks.
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float rise = t * (0.12 + 0.07 * fl);
    vec2 eq = vec2(p.x * (26.0 + 10.0 * fl) + fl * 31.0, (uv.y - ridge) * 22.0 - rise * 22.0);
    vec2 ecell = floor(eq);
    vec2 epos = vec2(hash(ecell + 3.1), hash(ecell + 6.9)) * 0.7 + 0.15;
    vec2 ef = fract(eq) - epos;
    float ember = exp(-dot(ef, ef) * 130.0) * step(0.75, hash(ecell + 12.7));
    float above = smoothstep(0.0, 0.02, uv.y - ridge) * exp(-(uv.y - ridge) * (9.0 - 4.0 * u_low));
    col += mix(LOW, vec3(1.0, 0.7, 0.35), 0.6) * ember * above * (0.25 + 0.8 * u_low + 1.6 * u_kick);
  }

  // ---- MID: the veil, two depths + light rays.
  float reach = 0.12 + 0.5 * u_mid;
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float wave = fbm(vec2(p.x * (1.3 + 0.6 * fl) + t * (0.06 + 0.05 * fl) + fl * 11.0, t * 0.1));
    float rippleV = u_snare * 0.3 * sin(p.x * (36.0 + 14.0 * fl) + t * 10.0);
    float center = 0.45 + 0.08 * fl + reach * (wave - 0.5) + rippleV;
    float veil = pow(max(0.0, 1.0 - abs(uv.y - center) / (0.1 + 0.25 * u_mid)), 3.0);
    float fabric = 0.55 + 0.45 * fbm(vec2(p.x * (9.0 + 5.0 * fl), uv.y * 2.0 - t * 0.3));
    col += MID * veil * fabric * (0.08 + 1.1 * u_mid) * (1.0 - 0.4 * fl);
    // Light rays shafting DOWN from the veil (classic aurora curtains).
    float rayField = pow(fbm(vec2(p.x * (5.0 + 2.0 * fl) - t * (0.15 + 0.1 * fl), 0.5 + fl)), 3.0);
    float below = smoothstep(0.0, 0.05, center - uv.y) * exp(-(center - uv.y) * 5.0);
    col += MID * rayField * below * (0.15 + 1.4 * u_mid) * (1.0 - 0.4 * fl);
  }

  // ---- HIGH: the stars. Three drifting parallax depths, sky only.
  float sky = 1.0 - ground;
  float stars = starLayer(p, 60.0, 0.006, t) * 0.5
    + starLayer(p, 110.0, 0.012, t) * 0.8
    + starLayer(p, 190.0, 0.024, t);
  col += vec3(0.75, 0.85, 1.0) * stars * sky * (0.15 + 1.1 * u_high + 1.8 * u_hat);
  // High shimmer band near the top: fine noctilucent ripples.
  float shimmer = pow(fbm(vec2(p.x * 14.0 + t * 0.4, uv.y * 6.0 - t * 0.2)), 4.0);
  col += HIGH * shimmer * smoothstep(0.65, 0.95, uv.y) * u_high * 0.9;

  // Shooting star: launched by a strong high transient (JS-triggered).
  if (u_streak <= 1.0) {
    vec2 start = vec2(aspect * (0.15 + 0.7 * u_streakSeed), 0.9 - 0.2 * fract(u_streakSeed * 7.0));
    vec2 dir = normalize(vec2(0.8, -0.35));
    vec2 head = start + dir * u_streak * 0.6 * aspect;
    vec2 toPoint = p - head;
    float along = clamp(dot(toPoint, -dir), 0.0, 0.12);
    float d = length(toPoint + dir * along);
    float tail = exp(-d * 500.0) * exp(-along * 25.0);
    col += vec3(1.0) * tail * (1.0 - u_streak) * sky;
  }

  // Drops lift the whole sky; quiet sections sit dark.
  col *= 0.7 + 0.55 * u_excite;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

export const strataPreset: VisualizerPreset = {
  id: 'strata',
  hiRes: true,
  name: 'Strata',
  create: () => {
    let streakStart = -Infinity;
    let streakSeed = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const progress = (frame.time - streakStart) / STREAK_S;
        if (frame.impulse.high > STREAK_TRIGGER && progress > 1.2) {
          streakStart = frame.time;
          streakSeed = Math.random();
        }
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_hat: frame.impulse.high,
          u_excite: 0.4 * energyOf(frame.bands) + 0.6 * frame.trend.excitement,
          u_streak: Math.min(2, (frame.time - streakStart) / STREAK_S),
          u_streakSeed: streakSeed,
        };
      },
    });
  },
};
