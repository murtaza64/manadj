/**
 * "g05 tunnel-shatter" (tweak of g02-tunnel-dream): the dreamy Milkdrop
 * warp tunnel — long feedback trails, gentle zoom, kick-lunge forward,
 * mid rotation, high sparkles, kept glow envelope — with EXACTLY ONE
 * element swapped: the tunnel WALLS become tempered-GLASS PANES.
 *
 * ELEMENT SWAP: wall segments are tempered-glass panels (a Voronoi pane
 * lattice wrapping the tunnel). A kick sends a SOLID crack pulse down the
 * nearest ring of panes. On a DROP the oncoming section of tunnel
 * SHATTERS and the camera flies through the shard cloud (riding
 * max(drop, energy)), the panes RE-FORMING over the next phrase
 * (beat.ladderBarIndex ?? beat.barIndex). A snare tinks small star-cracks
 * (mid/high gated). The drop is REFRACTION-driven (shard displacement of
 * the feedback), never a luminance flash — the dreamy glow envelope of
 * the parent is preserved; buildups stay vibrant (never still). Motion
 * and kick response stay the parent's (kick lunge raided from
 * g02-tunnel-punch's harder low term).
 */

import { energyOf, energyHue } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { UniformValue } from '../glPreset';
import type { VisualizerFrameData, VisualizerPreset } from '../types';

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_zoom;
uniform float u_rot;
uniform float u_decay;
uniform float u_seed;
uniform float u_spark;
uniform float u_shards;
uniform float u_beatPump;

uniform vec3 u_hueA;        // dreamy base hue (parent ramp, chroma-true)
uniform vec3 u_hueB;        // complementary sparkle hue
uniform float u_buildup;    // sustained pre-drop energy (never-still churn)
uniform float u_shatter;    // 0 panes intact … 1 fully shattered section
uniform float u_reform;     // 0 shattered … 1 re-formed (over the phrase)
uniform float u_crackRing;  // radius of the kick crack pulse (0..1.2)
uniform float u_crackAmp;   // kick crack strength

const float PI = 3.141592653589793;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
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

// Voronoi pane lattice. Returns .x = distance to nearest cell edge (the
// mortar / crack line), .yz = the nearest pane's cell id offset. The tunnel
// walls are these panes; cracks glow along the cell borders.
vec3 panes(vec2 p) {
  vec2 g = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 nearest = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 pt = o + hash2(g + o) * 0.85 + 0.075;
      float d = length(pt - f);
      if (d < d1) { d2 = d1; d1 = d; nearest = g + o; }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec3(d2 - d1, nearest);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);

  // ---- Tunnel wall coordinates: angle around, log-depth down the throat.
  // Panes tile this (angle, depth) space so they wrap the tunnel and slide
  // toward the viewer with the feedback.
  float depth = log(r + 0.05);
  vec2 wallUv = vec2(ang / PI * 4.0, depth * 5.0 - t * 0.5);
  vec3 pane = panes(wallUv);
  float paneId = hash(pane.yz + 3.1);

  // ---- SHATTER refraction: on a drop the oncoming section fractures and
  // each pane flies off along its own jittered normal — a REFRACTIVE
  // displacement of the feedback sample, NOT a luminance flash. reform
  // pulls the panes back to their seats over the phrase.
  float sectionMask = smoothstep(0.55, 0.15, r);      // oncoming (far) section
  float shatterNow = u_shatter * (1.0 - u_reform) * sectionMask;
  vec2 shardDir = normalize(hash2(pane.yz + 7.7) - 0.5 + 1e-4);
  float shardThrow = shatterNow * (0.5 + 0.5 * paneId) * (0.06 + 0.05 * u_shards);
  vec2 shatterOff = shardDir * shardThrow;

  // ---- Kick crack pulse: a solid crack ripping down the nearest ring of
  // panes (a travelling refraction wave, no flash).
  float crack = exp(-pow((r - u_crackRing) * 11.0, 2.0)) * u_crackAmp;
  vec2 crackOff = dirW * crack * 0.03;

  // ---- Warp the previous frame (parent motion: kick lunge + mid twist).
  float cs = cos(u_rot);
  float sn = sin(u_rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  float churn = (noise(vec2(ang * 4.0 + t * 0.3, r * 6.0 - t * 0.2)) - 0.5)
    * (0.004 + 0.02 * u_mid + 0.02 * u_buildup);   // buildups never sit still
  vec2 src = (w) / vec2(aspect, 1.0) + 0.5 + shatterOff + crackOff + dirW * churn;

  // Refraction chroma split — stronger through shattered glass and kicks.
  vec2 ab = dirW * (0.0012 + 0.006 * u_kick + 0.012 * shatterNow + 0.004 * crack)
    / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 glass = max(vec3(0.0), sampled * 1.25 - blur * 0.25) * u_decay;

  // ---- Fresh geometry. The wobbling mouth ring, seen THROUGH the panes.
  float wobble = 0.02 * u_mid;
  float ringR = 0.1 + 0.16 * u_low + sin(ang * 6.0 + t * 3.0) * wobble;
  float ringBand = exp(-pow((r - ringR) * 20.0, 2.0));
  float hue = fract(0.02 * t + r * 0.4 + ang * 0.08);
  vec3 wallHue = mix(u_hueA, u_hueB, hue);
  vec3 fresh = wallHue * ringBand * (0.6 + 1.4 * u_low + 1.0 * u_kick);

  // ---- Pane edges glow (the mortar lines / crack seams). Edge glow lifts
  // on kicks and along the crack pulse; panes darken slightly at centers so
  // the glass facets read.
  float edge = 1.0 - smoothstep(0.0, 0.06 + 0.05 * u_reform, pane.x);
  float facet = 0.55 + 0.45 * paneId;
  float seamGlow = edge * (0.25 + 1.2 * u_kick + 2.0 * crack + 1.5 * shatterNow);
  fresh += mix(u_hueB, u_hueA, paneId) * seamGlow
    * smoothstep(0.03, 0.5, r) * exp(-r * 1.2);
  fresh += wallHue * facet * (0.06 + 0.5 * u_low) * exp(-r * 1.6)
    * smoothstep(0.03, 0.6, r);

  // ---- Snare star-cracks (mid/high gated): tiny radial tinks on panes.
  if (u_spark > 0.001) {
    vec2 q = c * 24.0;
    vec2 cell = floor(q);
    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
    vec2 f = fract(q) - pos;
    float on = step(0.88, hash(sc * 1.618 + 9.7));
    // Star-crack: sharp radial spokes, not a round blob.
    float sd = length(f);
    float spokes = pow(abs(cos(atan(f.y, f.x) * 3.0)), 8.0);
    float starCrack = exp(-sd * 30.0) * (0.3 + spokes) * on;
    fresh += mix(u_hueB, vec3(1.0), 0.5) * starCrack * u_spark
      * smoothstep(0.06, 0.3, r);
  }

  // ---- Shard cloud: flying facets during the shatter (self-lit refraction
  // sparkle, gated by shatterNow — vibrant but not a full-field flash).
  if (shatterNow > 0.01) {
    float shardGlint = pow(edge, 0.5) * facet * (0.5 + 0.5 * sin(paneId * 30.0 + t * 8.0));
    fresh += mix(u_hueA, u_hueB, paneId) * shardGlint * shatterNow * 1.3;
  }

  vec3 col = glass + fresh * (1.0 - u_decay) * 3.4;
  col *= 1.0 + 0.06 * u_beatPump;

  // ---- Chroma-preserving soft knee (never per-channel clamp): compress
  // the LUMA above the knee, keep the hue — the drop reads as refraction,
  // not a white-out.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

type Rgb = [number, number, number];

/** HSL (h in 0..360, s/l in 0..1) → chroma-true rgb 0..1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
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

const OVERRIDES: Record<string, number> = { trail: 0.92, zoom: 0.65 };

export const g05TunnelShatterPreset: VisualizerPreset = {
  id: 'g05-tunnel-shatter',
  name: 'g05 tunnel-shatter',
  hiRes: true,
  params: [
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: OVERRIDES.trail },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2.5, step: 0.05, default: OVERRIDES.zoom },
    { id: 'shards', label: 'shatter throw', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rot = 0;

    // Drop / shatter genome state.
    let smoothDrop = 0;
    let prevDrop = 0;
    let lastDropAt = -99;
    let shatter = 0;          // current shatter level (eased)
    let shatterTarget = 0;
    let reform = 1;           // 1 = seated, drops to 0 on a shatter
    let reformPhraseStart: number | null = null;

    // Kick crack pulse.
    let crackRing = 99;
    let crackAmp = 0;

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData): Record<string, UniformValue> => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const beat = frame.beat;
        const shardsParam = frame.params.shards ?? 1;
        const zoomParam = frame.params.zoom ?? OVERRIDES.zoom;
        const trail = frame.params.trail ?? OVERRIDES.trail;

        // ---- Drop detection (g01 pattern): excitement gated by bass.
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        const buildup = Math.min(1, frame.trend.excitement * (1 - lowPresence));

        // The camera rides max(drop, energy) through the shard cloud.
        const dropRide = Math.max(smoothDrop, energy);

        // ---- Phrase tier: ladder-correct, falls back to barIndex.
        const phraseTier = beat
          ? Math.floor((beat.ladderBarIndex ?? beat.barIndex) / 4)
          : null;

        // Trigger a shatter on a fresh drop.
        if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastDropAt > 6) {
          lastDropAt = frame.time;
          shatterTarget = 1;
          reform = 0;
          reformPhraseStart = phraseTier;
        }
        prevDrop = smoothDrop;

        // Re-form over the next phrase: once a new phrase tier begins after
        // the shatter, ease reform back to 1 across that phrase.
        if (reformPhraseStart !== null && phraseTier !== null) {
          if (phraseTier > reformPhraseStart) {
            reform = Math.min(1, reform + dt / 2.4);
            if (reform >= 1) {
              reformPhraseStart = null;
              shatterTarget = 0;
            }
          }
        }

        // Shatter eases in fast, held while re-forming, driven by dropRide.
        const shatterAim = Math.max(shatterTarget * (1 - reform), 0.35 * dropRide * smoothDrop);
        shatter += (shatterAim - shatter) * (1 - Math.exp(-dt / 0.25));

        // ---- Kick crack pulse travelling down the nearest pane ring.
        crackRing += dt * 1.6;
        if (frame.impulse.low > 0.3 && crackRing > 0.25) {
          crackRing = 0.08;
          crackAmp = Math.min(1, frame.impulse.low * 1.3);
        }
        crackAmp = Math.max(0, crackAmp - dt * 2.2);

        // ---- Parent motion: kick lunge (raided punch's harder low term),
        // mid twist, dreamy trails; a shatter briefly lunges harder.
        const zoom = 1 + (0.28 + 1.2 * frame.bands.low * frame.bands.low
          + 3.5 * frame.impulse.low + 1.2 * shatter * dropRide) * zoomParam * dt;
        rot = (0.1 + 1.2 * frame.bands.mid + 1.8 * frame.impulse.mid) * dt;

        // ---- Dreamy hue envelope (parent's abstract ramp), chroma-true.
        const baseHue = energyHue(energy, frame.time * 6);
        const hueA = hslToRgb(baseHue, 1, 0.5 + 0.12 * frame.bands.low);
        const hueB = hslToRgb(baseHue + 150, 1, 0.62);

        // Snare star-cracks: mid/high gated.
        const snareGate = Math.min(
          1,
          frame.impulse.mid * (0.5 + 0.5 * frame.bands.high) * 1.2
        );

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_zoom: zoom,
          u_rot: rot,
          u_decay: Math.min(0.985, 0.9 + 0.085 * trail - 0.01 * energy),
          u_seed: Math.floor(frame.time * 20),
          u_spark: snareGate,
          u_shards: shardsParam,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_hueA: [hueA[0], hueA[1], hueA[2]],
          u_hueB: [hueB[0], hueB[1], hueB[2]],
          u_buildup: buildup,
          u_shatter: shatter,
          u_reform: reform,
          u_crackRing: crackRing,
          u_crackAmp: crackAmp,
        };
      },
    });
  },
};

export default g05TunnelShatterPreset;
