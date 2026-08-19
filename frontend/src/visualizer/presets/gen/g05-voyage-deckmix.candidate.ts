/**
 * "g05 voyage-deckmix" (gen-5 tweak of g00-voyage): the parent Voyage
 * verbatim — unsharp feedback tap, traveling kick ripple that lights what
 * it passes, charged event-horizon ring, localized lens swirl, phrase
 * swell — with ONE element swapped: the abstract cosine PALETTE ENGINE is
 * replaced by the AUDIBLE DECK MIX.
 *
 * Each audible deck contributes its identity hue (theme/deckColors). The
 * blend follows the decks' Master-audible level share, so a transition
 * literally TRAVELS the color of the scene from the outgoing deck to the
 * incoming one. Doubles (a shared track on two decks) and EQ kills shift
 * the mix. A wide phase span within each deck hue keeps the dust from
 * going monochrome. Everything else — motion, ripple, ring, swell — is the
 * parent unchanged.
 *
 * ASSIGNED SWAP: palette engine → deck-mix colors (decks levels/EQ/fader/
 * doubles).
 */

import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { UniformValue } from '../glPreset';
import type { DeckStateInfo } from '../../channel';
import type { VisualizerFrameData, VisualizerPreset } from '../types';
import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { DECK_COLORS } from '../../../theme/deckColors';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_lowSlow;    // motion-grade low: gravity-wave phase rate (erratic-motion law)
uniform float u_mid;
uniform float u_midSlow;    // motion-grade mid: churn/warp rate (erratic-motion law)
uniform float u_high;
uniform float u_kick;
uniform float u_snare;
uniform float u_centroid;
uniform float u_specHue;    // slow-tracked centroid (~1s EMA): dust hue follows spectral content
uniform float u_drop;
uniform float u_buildup;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_sustain;
uniform float u_armPhase;
uniform float u_dust;
uniform float u_charge;
uniform float u_spawnSnare;

// ---- DECK MIX (replaces the parent's cosine palette engine) ----
uniform vec3 u_deckPrimary;   // dominant audible deck identity hue
uniform vec3 u_deckSecondary; // second audible deck (== primary when solo)
uniform vec3 u_deckAccent;    // brightest/most-saturated tint of the mix
uniform float u_deckBlend;    // 0 solo … 1 evenly split transition
uniform float u_deckPresence; // total audible energy 0..1 (silence dims)

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
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

// DECK-MIX palette: t sweeps a wide phase span between the two audible deck
// hues (so shades/tints drift spatially and the dust never goes
// monochrome), the accent lifts the peaks, presence dims toward black when
// nothing is audible. A transition crossfades the whole cosmos from the
// outgoing deck to the incoming one, weighted by their level share.
vec3 palette(float t) {
  float s = 0.5 - 0.5 * cos(6.28318 * fract(t));
  // Spatial travel across the transition: at solo, drift stays inside the
  // primary hue; at a split, the whole field sweeps primary -> secondary.
  float split = mix(s, smoothstep(0.3, 0.7, s), u_deckBlend);
  vec3 base = mix(u_deckPrimary, u_deckSecondary, split);
  float peak = pow(s, 2.2);
  vec3 c = mix(base, u_deckAccent, 0.4 * peak);
  // Wide tint/shade span within the hue so dust reads as many shades.
  c *= 0.5 + 0.7 * (0.35 + 0.65 * s);
  c += (vec3(0.1, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup) * u_deckPresence;
  return c * (0.14 + 0.86 * u_deckPresence);
}

float starShape(vec2 f, float size) {
  float d2 = dot(f, f);
  float core = exp(-d2 * 1100.0 / size);
  float halo = exp(-d2 * 140.0 / size) * 0.2;
  float spikes = (exp(-abs(f.x) * 190.0 / size) * exp(-abs(f.y) * 16.0 / size)
    + exp(-abs(f.y) * 190.0 / size) * exp(-abs(f.x) * 16.0 / size)) * 0.55;
  return core + halo + spikes;
}

vec3 starScatter(vec2 c, float density, float sizeScale, float gate, float gain) {
  vec2 q = c * density;
  vec2 cell = floor(q);
  vec2 sc = cell + vec2(fract(u_seed * 0.7131) * 61.7, fract(u_seed * 0.3719) * 43.1);
  vec2 pos = vec2(hash(sc + 1.3), hash(sc.yx + 4.7)) * 0.7 + 0.15;
  vec2 f = fract(q) - pos;
  float on = step(gate - 0.09 * u_spawn, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  // Star tint samples the OWN deck-mix palette at each star's hash phase (wide
  // span, spectral-hue biased) instead of a fixed cool/warm ramp. Luminance
  // unchanged (starShape * on * bright * gain).
  vec3 tint = palette(hash(sc.yx + 29.3) * 1.6 + u_time * 0.02 + u_specHue * 0.5);
  return mix(tint, HIGH, 0.2) * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;

  // ---- Warp: differential rotation + churn + traveling kick ripple (parent).
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * c / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_midSlow + 0.012 * u_buildup);  // motion: slow bands (erratic-motion law)
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float horizon = (0.14 + 0.1 * u_low) * (1.0 + 0.07 * u_charge);
  float lens = (0.4 * u_low + 1.5 * u_kick) * (1.0 + 0.9 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 lensPull = dirW * lens * 0.055;
  vec2 src = (w + churn + ripple + lensPull) / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave)
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
  vec3 sky = max(vec3(0.0), sampled * 1.35 - blur * 0.35) * u_decay;

  // ---- Steady layers, injected at (1 - decay).
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  float corona = exp(-rc * (7.0 - 3.0 * u_low));
  // motion: slow bands (erratic-motion law) — gravity-wave travel rate
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_lowSlow)) * 0.5 + 0.5;
  float gravityGain = u_low * (0.5 + 0.8 * u_kick);
  // Gravity ripple color: a warm slice of the OWN deck-mix palette (spectral-
  // hue biased) instead of a fixed ember/LOW mix. Gain unchanged.
  vec3 gravityColor = palette(0.05 + t * 0.015 + u_specHue * 0.5);
  fresh += gravityColor
    * pow(gravity, 4.0) * exp(-r * 5.0) * gravityGain;
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  float bassOn = smoothstep(0.06, 0.3, u_low);
  // Ring color: a warm deck-mix palette slice (spectral-hue biased) charging
  // toward a warmer accent then white-hot at high charge. Palette supplies hue;
  // the charge->white ramp and gains preserve luminance.
  vec3 chargeColor = mix(palette(0.02 + u_specHue * 0.5), palette(0.12 + u_specHue * 0.5), clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge);
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * bassOn + 2.4 * u_kick + 0.8 * u_charge);
  // Coal heart: a deep, low-luma slice of the OWN palette (spectral-hue biased)
  // instead of a fixed dark red. Kept dark (0.55 floor) so it reads as coal;
  // gains/kick-whiten preserve luminance.
  vec3 coal = palette(0.0 + u_specHue * 0.5) * 0.55;
  fresh += mix(coal, vec3(1.0, 0.8, 0.7), 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  fresh += mix(coal, LOW, 0.4) * corona * (0.1 + 0.6 * u_low + 0.35 * u_kick);
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  // Streak: both ends sample the OWN palette (a wide phase offset for the cool
  // end, spectral-hue biased) instead of a fixed steel-blue.
  fresh += mix(palette(0.7 + u_specHue * 0.5), palette(t * 0.02), 0.65) * streak * (0.25 + 1.2 * u_low + 0.8 * u_kick);
  // The disk: spiral lanes + clouds in the TRAVELING deck-mix palette.
  float arm = sin(ang * 2.0 + log(r + 0.06) * 5.0 - u_armPhase + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  // SPECTRAL DUST TINT: the disk palette phase is biased by the slow-tracked
  // centroid (u_specHue, ~1s EMA) so dust hue follows spectral content.
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + t * 0.012 + u_centroid * 0.4 + u_specHue * 0.8);
  float reverb = 1.0 + 2.6 * rippleWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  fresh += diskColor * lanes * (0.1 + 1.2 * u_mid) * (0.5 + cloud) * u_dust * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * u_dust * centerDim * midGate * reverb;
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(u_deckAccent, palette(0.6 + t * 0.03), 0.6);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.08 + 1.7 * u_high) * u_dust * reverb;
  sky += fresh * (1.0 - u_decay) * (3.2 + 1.6 * u_sustain);

  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }

  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    // Shockwave hue from the OWN palette (spectral-hue biased) mixed toward a
    // warm-white accent. Kick gain / drop scaling unchanged (luminance identical).
    sky += mix(palette(0.05 + u_specHue * 0.5), vec3(1.0, 0.9, 0.8), 0.5) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }
  if (u_snare > 0.03) {
    float arc = exp(-pow((r - 0.3) * 30.0, 2.0)) * pow(0.5 + 0.5 * sin(ang * 3.0 + u_seed), 2.0);
    sky += palette(0.3 + t * 0.02) * arc * u_snare * 0.7;
  }
  if (u_spawn > 0.003 || u_spawnSnare > 0.003) {
    float reach = smoothstep(0.05, 0.18, r);
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2) * reach
      * mix(vec3(1.0), palette(0.15), 0.45);
  }

  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);

  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= 0.72 + 0.45 * max(u_drop, u_sustain) - 0.05 * u_buildup;
  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
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

function mixRgb(a: Rgb, b: Rgb, k: number): Rgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Push a deck color toward its brightest, most-saturated accent. */
function accentOf(rgb0: Rgb): Rgb {
  const peak = Math.max(rgb0[0], rgb0[1], rgb0[2], 1e-4);
  const norm: Rgb = [rgb0[0] / peak, rgb0[1] / peak, rgb0[2] / peak];
  return mixRgb(norm, [1, 1, 1], 0.3);
}

interface DeckMix {
  primary: Rgb;
  secondary: Rgb;
  accent: Rgb;
  blend: number;
  presence: number;
}

const NEUTRAL: Rgb = [0.06, 0.06, 0.09];

/** EQ-weighted audible weight: kills (low EQ knob) pull a deck out of the
 * mix, so a bass/mid/high kill shifts the color travel. */
function eqWeight(eq: { low: number; mid: number; high: number }): number {
  const avg = (eq.low + eq.mid + eq.high) / 3;
  return 0.25 + 0.75 * Math.min(1, Math.max(0, avg / 0.5));
}

function resolveDeckMix(active: (DeckStateInfo & { smooth: number })[]): DeckMix {
  if (active.length === 0) {
    return { primary: NEUTRAL, secondary: NEUTRAL, accent: [0.2, 0.2, 0.25], blend: 0, presence: 0 };
  }
  const ranked = [...active].sort((a, b) => b.smooth - a.smooth);
  const top = ranked[0];
  const second = ranked.length >= 2 ? ranked[1] : null;
  const primary = DECK_RGB[top.channel] ?? NEUTRAL;
  const secondary = second ? DECK_RGB[second.channel] ?? primary : primary;
  const blend = second ? Math.min(1, (second.smooth / Math.max(1e-4, top.smooth)) * 1.2) : 0;
  const accent = mixRgb(accentOf(primary), accentOf(secondary), 0.5 * blend);
  const presence = Math.min(1, active.reduce((sum, d) => sum + d.smooth, 0) * 1.15);
  return { primary, secondary, accent, blend, presence };
}

const candidate: VisualizerPreset = {
  id: 'g05-voyage-deckmix',
  name: 'g05 voyage-deckmix',
  hiRes: true,
  params: [
    { id: 'stars', label: 'star density', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'persistence', label: 'persistence', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let armPhase = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let charge = 0;
    // Slow-tracked centroid (~1s EMA): biases the dust/element palette phase so
    // dust hue follows spectral content without jerking on transients.
    let slowCentroid = 0.5;

    // Deck-mix state: per-channel smoothed EQ-weighted audible levels + eased
    // palette colors so a transition crossfades the cosmos rather than snapping.
    const levels = new Map<string, number>();
    const primaryCur: Rgb = [...NEUTRAL];
    const secondaryCur: Rgb = [...NEUTRAL];
    const accentCur: Rgb = [0.2, 0.2, 0.25];
    let blendCur = 0;
    let presenceCur = 0;
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
        // motion: slow bands (erratic-motion law)
        const motion = frame.bandsSlow ?? frame.bands;
        const energyMotion = energyOf(motion);
        const speed = frame.params.speed ?? 1;
        const persistence = frame.params.persistence ?? 1;

        // ---- Deck mix: EQ-weighted smoothed levels, resolve, ease. ----
        const active: (DeckStateInfo & { smooth: number })[] = [];
        for (const deck of frame.decks) {
          const weighted = deck.level * eqWeight(deck.eq) * (0.35 + 0.65 * deck.fader);
          const previous = levels.get(deck.channel) ?? 0;
          const tau = weighted > previous ? 0.05 : 0.35;
          const a = 1 - Math.exp(-dt / tau);
          const smooth = previous + (weighted - previous) * a;
          levels.set(deck.channel, smooth);
          if (smooth > 0.02) active.push({ ...deck, smooth });
        }
        const mix = resolveDeckMix(active);
        const colorEase = 1 - Math.exp(-dt / 0.6);
        const scalarEase = 1 - Math.exp(-dt / 0.4);
        easeColor(primaryCur, mix.primary, colorEase);
        easeColor(secondaryCur, mix.secondary, colorEase);
        easeColor(accentCur, mix.accent, colorEase);
        blendCur += (mix.blend - blendCur) * scalarEase;
        presenceCur += (mix.presence - presenceCur) * scalarEase;

        // ---- Voyage engine (parent, unchanged). ----
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const drop = smoothDrop;
        const buildup = smoothBuildup;
        const sustained = Math.min(1, energy * 1.4);
        // motion: slow bands (erratic-motion law) — cruise rides slow energy so
        // travel/rotation don't jerk with each transient.
        const sustainedMotion = Math.min(1, energyMotion * 1.4);
        const lift = Math.max(drop, 0.7 * sustainedMotion);
        const zoom =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) * speed * dt -
          0.3 * buildup * dt;
        armPhase += dt * (frame.beat?.bpm ? ((frame.beat.bpm / 60) * Math.PI * 2) / 64 : 0.12);
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }
        const baseDecay = 0.992 - 0.008 * energy - 0.008 * buildup;
        // ~1s EMA of the centroid -> spectral dust hue bias (u_specHue).
        slowCentroid += (frame.centroid - slowCentroid) * (1 - Math.exp(-dt / 1.0));
        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_lowSlow: motion.low, // motion: slow bands (erratic-motion law)
          u_mid: frame.bands.mid,
          u_midSlow: motion.mid, // motion: slow bands (erratic-motion law)
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_centroid: frame.centroid,
          u_specHue: slowCentroid,
          u_drop: drop,
          u_buildup: buildup,
          u_zoom: zoom,
          // motion: slow bands (erratic-motion law) — differential rotation rate
          u_rotStep: (0.05 + 0.5 * motion.mid + 0.5 * buildup + 0.25 * sustainedMotion) * speed * dt,
          u_decay: Math.min(0.998, 1 - (1 - baseDecay) / persistence),
          u_seed: Math.floor(frame.time * 20),
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_sustain: sustained,
          u_armPhase: armPhase,
          u_charge: charge,
          u_dust: frame.params.dust ?? 1,
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (frame.params.stars ?? 1) *
              (0.4 + 0.6 * Math.max(drop, sustained))) /
              (1 + 1.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) * (frame.params.stars ?? 1) *
              (0.5 + 0.5 * Math.max(drop, sustained))) /
              (1 + 0.8 * buildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_deckPrimary: [primaryCur[0], primaryCur[1], primaryCur[2]],
          u_deckSecondary: [secondaryCur[0], secondaryCur[1], secondaryCur[2]],
          u_deckAccent: [accentCur[0], accentCur[1], accentCur[2]],
          u_deckBlend: blendCur,
          u_deckPresence: presenceCur,
        };
      },
    });
  },
};

export default candidate;
