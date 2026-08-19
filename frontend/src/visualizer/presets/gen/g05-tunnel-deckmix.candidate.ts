/**
 * "g05 tunnel-deckmix" (tweak of g02-tunnel-dream): the dreamy Milkdrop
 * warp tunnel — long feedback trails, gentle zoom, kick-lunge forward,
 * mid rotation, high sparkles — with EXACTLY ONE element swapped: the
 * palette engine.
 *
 * ELEMENT SWAP: the tunnel's abstract hue ramp is replaced by DECK-MIX
 * COLORS. Deck identity hues (theme/deckColors) paint the walls. The
 * incoming deck's color is born at the FAR end of the tunnel (screen
 * center, small radius) and TRAVELS toward the viewer (outer radius) as
 * its Master-audible level / fader rises — so a live mix visibly flows
 * down the tunnel. A deck's EQ kill mutes its matching color band. When
 * two audible decks share a trackId (DOUBLES) both hues snap into
 * interleaved concentric rings. A wide in-hue phase span keeps the walls
 * from ever going flat monochrome. Motion, dreaminess and kick response
 * stay the parent's (raided g02-tunnel-punch's harder kick term for the
 * lunge).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { UniformValue } from '../glPreset';
import type { DeckStateInfo } from '../../channel';
import type { VisualizerFrameData, VisualizerPreset } from '../types';
import { DECK_COLORS } from '../../../theme/deckColors';

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
uniform float u_flow;
uniform float u_beatPump;

// ---- DECK MIX (replaces the tunnel's abstract hue ramp) ----
uniform vec3 u_deckPrimary;
uniform vec3 u_deckSecondary;
uniform vec3 u_deckAccent;
uniform float u_deckBlend;      // 0 solo … 1 evenly split transition
uniform float u_deckPresence;   // total audible energy 0..1
uniform float u_deckArrival;    // 0 far end … 1 arrived at the viewer
uniform float u_doubles;        // 0..1 doubles lock (interleaved-ring tell)
uniform vec3 u_bandGain;        // per-color-band survival after EQ kills

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

// Deck-mix palette. depth: 0 at the far tunnel end … 1 at the viewer.
// The incoming (secondary) deck rides in from depth 0; arrival pushes its
// color out toward the walls (depth 1). span keeps a WIDE in-hue phase
// sweep so a wall never collapses to one flat tone. bandGain applies EQ
// kills per color band (r/g/b weighted to the dominant deck hue).
vec3 deckPalette(float depth, float span) {
  float s = 0.5 - 0.5 * cos(6.28318 * fract(span));
  // Where along the tunnel the incoming deck has advanced to.
  float front = mix(0.06, 1.04, u_deckArrival);
  float incoming = smoothstep(front + 0.28, front - 0.28, depth);
  float split = mix(s, incoming, clamp(u_deckBlend, 0.0, 1.0));
  vec3 base = mix(u_deckPrimary, u_deckSecondary, split);
  float peak = pow(s, 2.0);
  vec3 c = mix(base, u_deckAccent, 0.30 * peak);
  c *= u_bandGain;                       // EQ kill mutes that color band
  c *= 0.45 + 0.6 * (0.35 + 0.65 * s);   // wide brightness sweep, no flat wall
  return c * (0.14 + 0.86 * u_deckPresence);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp the previous frame: zoom toward the viewer (kick lunge) with
  // a mid-driven twist. Milkdrop feedback advection — the tunnel walls are
  // successive rings smeared inward. (Parent motion, kept.)
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  float cs = cos(u_rot);
  float sn = sin(u_rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  float churn = (noise(vec2(ang * 4.0 + t * 0.3, r * 6.0 - t * 0.2)) - 0.5)
    * (0.004 + 0.02 * u_mid);
  vec2 src = (w + dirW * churn) / vec2(aspect, 1.0) + 0.5;

  // Chromatic advection — a gentle dreamy split, stronger on a kick.
  vec2 ab = dirW * (0.0012 + 0.006 * u_kick + 0.003 * u_flow) / vec2(aspect, 1.0);
  vec3 sampled = vec3(
    texture2D(u_prev, src + ab).r,
    texture2D(u_prev, src).g,
    texture2D(u_prev, src - ab).b
  );
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  vec3 walls = max(vec3(0.0), sampled * 1.25 - blur * 0.25) * u_decay;

  // ---- Fresh geometry: the wobbling ring at the tunnel mouth, painted in
  // the deck mix. depth = radius (far end at center → viewer at the rim).
  float depth = clamp(r * 1.35, 0.0, 1.0);
  float wobble = 0.02 * u_mid;
  float ringR = 0.1 + 0.16 * u_low + sin(ang * 6.0 + t * 3.0) * wobble;
  float ringBand = exp(-pow((r - ringR) * 20.0, 2.0));

  // Wide in-hue phase span across the wall: angle + depth + flow travel.
  float span = ang / (2.0 * PI) + depth * 0.9 + u_deckArrival * 0.5 + t * 0.02 * u_flow;
  vec3 ringColor = deckPalette(depth, span);
  vec3 fresh = ringColor * ringBand * (0.6 + 1.4 * u_low + 1.1 * u_kick);

  // Continuous wall glow so the deck mix flows the whole tunnel, not just
  // the mouth ring — the incoming color streams from far end to rim.
  float wallGlow = smoothstep(0.02, 0.5, r) * exp(-r * 1.4);
  fresh += deckPalette(depth, span + 0.15) * wallGlow
    * (0.18 + 0.9 * u_deckPresence) * (0.6 + 0.7 * u_mid);

  // ---- DOUBLES: interleaved concentric rings snapping both deck hues.
  if (u_doubles > 0.5) {
    float rings = 9.0;
    float phase = fract(r * rings - t * 0.4 * (0.5 + 0.5 * u_flow));
    float interleave = step(0.5, phase);
    vec3 twinA = deckPalette(depth, 0.15);
    vec3 twinB = deckPalette(depth, 0.65);
    vec3 twin = mix(twinA, twinB, interleave);
    float ringTell = pow(0.5 + 0.5 * cos(6.28318 * r * rings - t * 2.0), 4.0);
    fresh += twin * ringTell * u_doubles * (0.4 + 0.9 * u_low + 0.8 * u_kick)
      * smoothstep(0.03, 0.2, r);
  }

  // ---- High-driven sparkles — feedback stretches them into star-streaks.
  if (u_spark > 0.001) {
    vec2 q = c * 26.0;
    vec2 cell = floor(q);
    vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
    vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
    vec2 f = fract(q) - pos;
    float on = step(0.86, hash(sc * 1.618 + 9.7));
    float star = exp(-dot(f, f) * 240.0) * on;
    vec3 spk = mix(u_deckAccent, vec3(1.0), 0.4);
    fresh += spk * star * u_spark * smoothstep(0.08, 0.3, r);
  }

  vec3 col = walls + fresh * (1.0 - u_decay) * 3.4;
  col *= 1.0 + 0.06 * u_beatPump;

  // ---- Chroma-preserving soft knee (never per-channel clamp): compress
  // the LUMA above the knee, keep the hue.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.85) {
    col *= (0.85 + 0.15 * (1.0 - exp(-(m - 0.85) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

type Rgb = [number, number, number];

/** '#rrggbb' → [r,g,b] in 0..1 (deck identity color, chroma-true). */
function hexToRgb01(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const DECK_RGB: Record<string, Rgb> = Object.fromEntries(
  Object.entries(DECK_COLORS).map(([deck, hex]) => [deck, hexToRgb01(hex)])
) as Record<string, Rgb>;

const NEUTRAL: Rgb = [0.06, 0.06, 0.09];

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Push a deck color toward its brightest, most-saturated accent. */
function accentOf(rgb: Rgb): Rgb {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
  const norm: Rgb = [rgb[0] / peak, rgb[1] / peak, rgb[2] / peak];
  return mixRgb(norm, [1, 1, 1], 0.35);
}

interface DeckMix {
  primary: Rgb;
  secondary: Rgb;
  accent: Rgb;
  blend: number;
  presence: number;
  arrival: number;
  doubles: number;
  /** Per-color-band survival after EQ kills, in the dominant hue's basis. */
  bandGain: Rgb;
}

/** EQ knob 0..1 (0.5 flat): a knob near 0 is a KILL. Map to a 0..1 gain
 * that mutes the band it kills. */
function eqGain(knob: number): number {
  return Math.min(1, Math.max(0, knob / 0.5));
}

function resolveDeckMix(active: (DeckStateInfo & { smooth: number })[]): DeckMix {
  if (active.length === 0) {
    return {
      primary: NEUTRAL,
      secondary: NEUTRAL,
      accent: [0.2, 0.2, 0.25],
      blend: 0,
      presence: 0,
      arrival: 0.5,
      doubles: 0,
      bandGain: [1, 1, 1],
    };
  }
  const ranked = [...active].sort((a, b) => b.smooth - a.smooth);
  const top = ranked[0];
  const second = ranked.length >= 2 ? ranked[1] : null;
  const primary = DECK_RGB[top.channel] ?? NEUTRAL;
  const secondary = second ? DECK_RGB[second.channel] ?? primary : primary;
  const blend = second ? Math.min(1, (second.smooth / Math.max(1e-4, top.smooth)) * 1.2) : 0;
  const accent = mixRgb(accentOf(primary), accentOf(secondary), 0.5 * blend);
  const presence = Math.min(1, active.reduce((sum, d) => sum + d.smooth, 0) * 1.15);
  const doubles =
    second && top.trackId !== null && top.trackId === second.trackId
      ? Math.min(1, blend * 1.4)
      : 0;

  // The incoming deck (secondary) travels down the tunnel as its own
  // level/fader climb: arrival 0 = still at the far end, 1 = at the viewer.
  const incomingDeck = second ?? top;
  const arrival = Math.min(1, incomingDeck.smooth * incomingDeck.fader * 1.6);

  // EQ kills of the DOMINANT deck mute its matching color band. Deck hues
  // are saturated primaries/secondaries; map low→one channel, mid→another,
  // high→a third, weighted toward the primary's own channel spread so a
  // killed band visibly removes the wall's color.
  const lowG = eqGain(top.eq.low);
  const midG = eqGain(top.eq.mid);
  const highG = eqGain(top.eq.high);
  const bandGain: Rgb = [
    0.2 + 0.8 * highG,
    0.2 + 0.8 * midG,
    0.2 + 0.8 * lowG,
  ];
  return { primary, secondary, accent, blend, presence, arrival, doubles, bandGain };
}

const OVERRIDES: Record<string, number> = { trail: 0.92, zoom: 0.65 };

export const g05TunnelDeckmixPreset: VisualizerPreset = {
  id: 'g05-tunnel-deckmix',
  name: 'g05 tunnel-deckmix',
  hiRes: true,
  params: [
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: OVERRIDES.trail },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2.5, step: 0.05, default: OVERRIDES.zoom },
    { id: 'flow', label: 'deck flow', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rot = 0;

    const levels = new Map<string, number>();
    const primaryCur: Rgb = [...NEUTRAL];
    const secondaryCur: Rgb = [...NEUTRAL];
    const accentCur: Rgb = [0.2, 0.2, 0.25];
    const bandGainCur: Rgb = [1, 1, 1];
    let blendCur = 0;
    let presenceCur = 0;
    let arrivalCur = 0.5;
    let doublesCur = 0;

    const easeColor = (cur: Rgb, target: Rgb, k: number): void => {
      cur[0] += (target[0] - cur[0]) * k;
      cur[1] += (target[1] - cur[1]) * k;
      cur[2] += (target[2] - cur[2]) * k;
    };

    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame: VisualizerFrameData): Record<string, UniformValue> => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const energy = energyOf(frame.bands);
        const beat = frame.beat;
        const flow = frame.params.flow ?? 1;
        const zoomParam = frame.params.zoom ?? OVERRIDES.zoom;
        const trail = frame.params.trail ?? OVERRIDES.trail;

        // ---- Deck mix: smooth per-channel audible levels, resolve, ease.
        const active: (DeckStateInfo & { smooth: number })[] = [];
        for (const deck of frame.decks) {
          const previous = levels.get(deck.channel) ?? 0;
          const tau = deck.level > previous ? 0.05 : 0.35;
          const a = 1 - Math.exp(-dt / tau);
          const smooth = previous + (deck.level - previous) * a;
          levels.set(deck.channel, smooth);
          if (smooth > 0.02) active.push({ ...deck, smooth });
        }
        const mix = resolveDeckMix(active);
        const colorEase = 1 - Math.exp(-dt / 0.6);
        const scalarEase = 1 - Math.exp(-dt / 0.4);
        easeColor(primaryCur, mix.primary, colorEase);
        easeColor(secondaryCur, mix.secondary, colorEase);
        easeColor(accentCur, mix.accent, colorEase);
        easeColor(bandGainCur, mix.bandGain, scalarEase);
        blendCur += (mix.blend - blendCur) * scalarEase;
        presenceCur += (mix.presence - presenceCur) * scalarEase;
        // Arrival eases slowly so the incoming color visibly travels.
        arrivalCur += (mix.arrival - arrivalCur) * (1 - Math.exp(-dt / 1.1));
        doublesCur += (mix.doubles - doublesCur) * scalarEase;

        // ---- Parent motion: kick lunge (raided punch's harder low term),
        // mid twist, dreamy long trails.
        const zoom = 1 + (0.28 + 1.2 * frame.bands.low * frame.bands.low
          + 3.5 * frame.impulse.low) * zoomParam * dt;
        rot = (0.1 + 1.2 * frame.bands.mid + 1.8 * frame.impulse.mid) * dt;

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
          u_spark: Math.min(1, 1.1 * frame.impulse.high + 0.2 * frame.bands.high),
          u_flow: flow,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_deckPrimary: [primaryCur[0], primaryCur[1], primaryCur[2]],
          u_deckSecondary: [secondaryCur[0], secondaryCur[1], secondaryCur[2]],
          u_deckAccent: [accentCur[0], accentCur[1], accentCur[2]],
          u_deckBlend: blendCur,
          u_deckPresence: presenceCur,
          u_deckArrival: arrivalCur,
          u_doubles: doublesCur,
          u_bandGain: [bandGainCur[0], bandGainCur[1], bandGainCur[2]],
        };
      },
    });
  },
};

export default g05TunnelDeckmixPreset;
