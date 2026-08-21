/**
 * g15-droste (gen-15 NOVEL, feedback-space optics lens).
 *
 * INFINITE POSTER TUNNEL. The optic living inside the resample loop is an
 * OCTAVE-ECHO TAP: alongside the main tap (which slowly magnifies, so
 * content marches outward with a genome twist per octave — log-spiral
 * Droste), a second tap samples the previous frame at 2x coordinates — a
 * half-size self-copy blended in near the center. Every structure spawns
 * a shrunken copy of itself that then grows: a kick ring becomes
 * rings-of-rings cascading outward, bar after bar.
 *
 * FLAT APPETITE: this is flat design in motion, not glowy feedback soup.
 * Stamps are OPAQUE CONVEX MIXES (no additive bloom): solid matte fills,
 * hard edges, a committed 4-color scheme (near-black ground + three
 * saturated inks from the trackId genome). The field decays toward the
 * GROUND color (convex — contraction by construction), never to additive
 * black-glow.
 *
 * MUSIC MAPPING:
 *   KICK      a thick hard-edged ring in the punch ink (solid response) —
 *             the cascade's seed.
 *   SNARE     an n-gon outline (n and orientation hashed per hit).
 *   BAR       a sector wipe repaints an advancing ~60° slice in the next
 *             ink (luminance-matched inks — photosafe color swap).
 *   SECTION   (ladderBarIndex ?? barIndex, 16 bars) the whole scheme
 *             re-rolls from the genome (dominantChannel LAW) — theatre.
 *   BUILDUP   the march reverses to a gentle inward collapse; echo fades.
 *   DROP      march + echo strength lift, riding max(drop, energy).
 *   FLATNESS  tonal sound = razor edges; noisy = soft edges.
 *   SPREAD    twist magnitude (wide spectrum = stronger spiral).
 *
 * CONTRACTION: echo blend and all stamps are convex mixes; decay-to-ground
 * is convex; no whole-field multiplicative gain > 1 anywhere; soft knee
 * kept as a guard. Zoom/twist rates ride bandsSlow (erratic-motion law).
 * GLSL ES 1.0, no backticks in GLSL.
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const splitmix01 = (n: number): number => {
  let x = (Math.floor(Math.abs(n)) + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
};

// HSV -> RGB with a luminance clamp so scheme swaps are photosafe
// (comparable mean luminance across inks).
const hsv = (h: number, s: number, v: number): [number, number, number] => {
  const i = Math.floor(((h % 1) + 1) % 1 * 6);
  const f = (((h % 1) + 1) % 1) * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const pick: [number, number, number][] = [
    [v, t, p], [q, v, p], [p, v, t], [t, p, v], [v, p, q], [v, q, p],
  ];
  const c = pick[i % 6];
  const luma = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const target = 0.55;
  const k = luma > 0.01 ? Math.min(1.6, target / luma) : 1;
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
};

// No backticks inside this GLSL string (GLSL ES 1.0).
const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_zoom;      // per-frame magnification (buildup: < 1)
uniform float u_twist;     // per-frame rotation step
uniform float u_octTwist;  // fixed twist between octave copies (genome)
uniform float u_echo;      // octave-echo blend strength
uniform float u_decayK;    // convex decay toward ground (0..1, < 1)
uniform float u_edgeW;     // stamp edge softness (flatness-driven)
uniform vec3 u_ground;
uniform vec3 u_ink1;       // punch (kick)
uniform vec3 u_ink2;       // secondary (wipes)
uniform vec3 u_ink3;       // accent (snare gons)
uniform float u_ringAmp;   // kick ring stamp alpha env
uniform float u_ringR;
uniform float u_ringW;
uniform float u_gonAmp;    // snare n-gon stamp alpha env
uniform float u_gonN;
uniform float u_gonRot;
uniform float u_gonR;
uniform float u_wipeAmp;   // bar sector wipe alpha env
uniform float u_wipeAng;   // sector center angle
uniform float u_wipeInk;   // 0..2 -> which ink paints the wipe
uniform float u_beatPulse; // subtle ground breathing on the beat

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 rot2(vec2 p, float a) {
  float cs = cos(a);
  float sn = sin(a);
  return mat2(cs, -sn, sn, cs) * p;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);

  // ---- Main tap: magnify + twist (content marches outward, spiraling).
  vec2 mc = rot2(c / u_zoom, u_twist);
  vec3 mainTap = texture2D(u_prev, mc / vec2(aspect, 1.0) + 0.5).rgb;
  // ---- Octave-echo tap: the half-size self-copy, twisted per octave.
  // Gated to the central region where 2x coordinates stay in-texture.
  vec2 ec = rot2(c * 2.0, u_octTwist);
  vec3 echoTap = texture2D(u_prev, ec / vec2(aspect, 1.0) + 0.5).rgb;
  float echoMask = smoothstep(0.24, 0.15, r);
  vec3 field = mix(mainTap, echoTap, u_echo * echoMask);

  // Mild unsharp to keep ink edges crisp through resampling — kept SMALL
  // and clamped to [0,1]: at 0.35 the sharpen ringed on hard flat edges
  // and re-amplified each frame into rainbow fizz (gen-15 smoke run).
  vec2 px = 1.0 / u_res;
  vec3 blur = (texture2D(u_prev, mc / vec2(aspect, 1.0) + 0.5 + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, mc / vec2(aspect, 1.0) + 0.5 - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, mc / vec2(aspect, 1.0) + 0.5 + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, mc / vec2(aspect, 1.0) + 0.5 - vec2(0.0, px.y)).rgb) * 0.25;
  field = clamp(field + (field - blur) * 0.1, 0.0, 1.0);

  // Convex decay toward the matte ground — contraction by construction.
  vec3 ground = u_ground * (1.0 + 0.12 * u_beatPulse);
  field = mix(ground, field, u_decayK);

  // ---- FLAT stamps: opaque convex mixes, hard edges.
  // Kick ring: thick, in the punch ink.
  if (u_ringAmp > 0.01) {
    float ringD = abs(r - u_ringR);
    float a = (1.0 - smoothstep(u_ringW - u_edgeW, u_ringW + u_edgeW, ringD)) * u_ringAmp;
    field = mix(field, u_ink1, clamp(a, 0.0, 0.92));
  }
  // Snare n-gon outline.
  if (u_gonAmp > 0.01) {
    float b = 6.28318 / u_gonN;
    float aa = ang + u_gonRot;
    float da = mod(aa, b) - b * 0.5;
    float pd = r * cos(da); // distance to the face plane
    float d = abs(pd - u_gonR);
    float a = (1.0 - smoothstep(0.008 - u_edgeW * 0.5, 0.012 + u_edgeW, d)) * u_gonAmp;
    field = mix(field, u_ink3, clamp(a, 0.0, 0.85));
  }
  // Bar sector wipe: repaint an advancing ~60 deg slice (flat fill).
  if (u_wipeAmp > 0.01) {
    float dAng = abs(mod(ang - u_wipeAng + 3.14159, 6.28318) - 3.14159);
    float inSector = 1.0 - smoothstep(0.5 - u_edgeW * 8.0, 0.5 + u_edgeW * 8.0, dAng);
    vec3 ink = u_wipeInk < 0.5 ? u_ink1 : (u_wipeInk < 1.5 ? u_ink2 : u_ink3);
    float a = inSector * u_wipeAmp * smoothstep(0.04, 0.1, r);
    field = mix(field, ink * 0.9, clamp(a, 0.0, 0.7));
  }
  // Center medallion: a small solid disc keeps the cascade seeded and
  // hides the echo singularity. Punch ink, breathing with the beat.
  float med = 1.0 - smoothstep(0.028 + 0.012 * u_beatPulse - u_edgeW,
    0.032 + 0.012 * u_beatPulse + u_edgeW, r);
  field = mix(field, u_ink2, med * 0.85);

  // Tiny grain (flat design: nearly none).
  field += (hash(gl_FragCoord.xy + fract(u_time) * 191.0) - 0.5) * 0.004;

  // Soft knee guard (chroma-preserving).
  float m = max(field.r, max(field.g, field.b));
  if (m > 0.8) {
    field *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(field, 0.0), 1.0);
}
`;

const preset: VisualizerPreset = {
  id: 'g15-droste',
  name: 'g15 Droste',
  hiRes: true,
  params: [
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'march', label: 'march speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'echo', label: 'octave echo', min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  create: () => {
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let slowFlat = 0.3;
    let slowSpread = 0.5;
    let ringAmp = 0;
    let gonAmp = 0;
    let gonN = 4;
    let gonRot = 0;
    let gonR = 0.2;
    let wipeAmp = 0;
    let wipeAng = 0;
    let wipeInk = 0;
    let lastBar = -1;
    let lastSection = -1;
    let schemeHue = 0.02;
    let octTwist = 0.35;
    let lastAnchorTrack: number | null = null;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = Math.min(0.1, Math.max(1 / 240, frame.dt || 1 / 60));
        const motion = frame.bandsSlow ?? frame.bands;
        const energy = energyOf(frame.bands);
        const energyMotion = energyOf(motion);
        const alpha = 1 - Math.exp(-dt / 0.35);
        if (frame.regime) {
          smoothDrop += (Math.max(frame.regime.dropTransition, frame.regime.sustained) - smoothDrop) * alpha;
          smoothBuildup += (frame.regime.buildup - smoothBuildup) * alpha;
        } else {
          const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
          smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
          smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        }
        const drive = Math.max(smoothDrop, Math.min(1, energy * 1.3));
        // Slow spectral shape trackers (edge softness / twist).
        slowFlat += (frame.flatness - slowFlat) * (1 - Math.exp(-dt / 0.8));
        slowSpread += (frame.spread - slowSpread) * (1 - Math.exp(-dt / 0.8));
        // Genome scheme (dominantChannel LAW) + section re-roll.
        if (frame.dominantChannel) {
          const deck = frame.decks.find((d) => d.channel === frame.dominantChannel);
          if (deck && deck.trackId !== null && deck.trackId !== lastAnchorTrack) {
            lastAnchorTrack = deck.trackId;
            schemeHue = splitmix01(deck.trackId);
            octTwist = 0.2 + 0.5 * splitmix01(deck.trackId * 7 + 3);
          }
        }
        const bar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : null;
        if (bar !== null) {
          if (bar !== lastBar) {
            lastBar = bar;
            // Bar wipe: advance the sector (golden-angle steps) and cycle ink.
            wipeAmp = 1;
            wipeAng = (bar * 2.39996) % (Math.PI * 2);
            wipeInk = bar % 3;
          }
          const section = Math.floor(bar / 16);
          if (section !== lastSection) {
            lastSection = section;
            schemeHue = splitmix01((lastAnchorTrack ?? 1) * 131 + section * 29);
          }
        }
        // Stamp envelopes (fast decays: crisp stamps, the cascade does the rest).
        ringAmp = Math.min(1, ringAmp * Math.exp(-dt / 0.09) + frame.impulse.low * 1.1);
        gonAmp *= Math.exp(-dt / 0.1);
        if (frame.impulse.mid > 0.4 && gonAmp < 0.25) {
          gonAmp = Math.min(1, frame.impulse.mid * 1.1);
          const h = splitmix01(Math.floor(frame.time * 37));
          gonN = 3 + Math.floor(h * 4); // 3..6
          gonRot = h * Math.PI * 2;
          gonR = 0.14 + 0.12 * splitmix01(Math.floor(frame.time * 37) + 5);
        }
        wipeAmp *= Math.exp(-dt / 0.22);
        // March: outward on drops/plateaus, gentle inward collapse on
        // buildups. Rates ride bandsSlow (motion law).
        const march = frame.params.march ?? 1;
        const rate = (0.16 + 0.5 * energyMotion + 0.35 * drive) * march - 0.45 * smoothBuildup * march;
        const zoom = Math.max(0.96, 1 + rate * dt);
        const twistRate = (slowSpread - 0.35) * (0.25 + 0.5 * energyMotion);
        const persistence = frame.params.persistence ?? 1;
        const decayBase = 0.988;
        const decayK = Math.min(0.996, 1 - (1 - decayBase) / persistence);
        // Scheme: near-black ground + three luminance-matched inks.
        const ground: [number, number, number] = [
          0.035 + 0.03 * splitmix01(schemeHue * 1e5),
          0.035,
          0.05,
        ];
        const ink1 = hsv(schemeHue, 0.92, 1.0);
        const ink2 = hsv(schemeHue + 0.46, 0.85, 0.95);
        const ink3 = hsv(schemeHue + 0.12, 0.75, 1.0);
        const beatPulse = frame.beat ? Math.pow(Math.max(0, 1 - frame.beat.phase * 2), 2) : 0;
        return {
          u_time: frame.time,
          u_zoom: zoom,
          u_twist: twistRate * dt,
          u_octTwist: octTwist,
          u_echo: Math.min(0.5, (frame.params.echo ?? 0.6) * (0.4 + 0.5 * motion.mid + 0.3 * drive) / (1 + 1.2 * smoothBuildup)),
          u_decayK: decayK,
          u_edgeW: 0.002 + 0.018 * slowFlat,
          u_ground: ground,
          u_ink1: ink1,
          u_ink2: ink2,
          u_ink3: ink3,
          u_ringAmp: ringAmp,
          u_ringR: 0.09 + 0.05 * frame.bands.low,
          u_ringW: 0.02 + 0.02 * frame.impulse.low,
          u_gonAmp: gonAmp,
          u_gonN: gonN,
          u_gonRot: gonRot,
          u_gonR: gonR,
          u_wipeAmp: wipeAmp,
          u_wipeAng: wipeAng,
          u_wipeInk: wipeInk,
          u_beatPulse: beatPulse,
        };
      },
    });
  },
};

export default preset;
