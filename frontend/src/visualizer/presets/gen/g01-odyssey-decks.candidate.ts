/**
 * "g01 odyssey-decks" (crossover g01-odyssey × decks): Odyssey's full
 * galactic engine — dust disk, electric high nebula, charged event-horizon
 * ring, black-hole lens, kick ripples, warp-mode cycling, genome mutations
 * on phrase/section boundaries — but the PALETTE is no longer an abstract
 * genome cosine ramp. It is the AUDIBLE DECK MIX.
 *
 * One deck playing → its identity color (theme/deckColors) owns the whole
 * universe. A transition (two audible decks) crossfades the cosmos between
 * the two deck colors, weighted by their Master-audible level share.
 * DOUBLES (two audible decks sharing a trackId) lock a visible symmetry
 * tell: twin cores flanking the black hole plus a mirror-fold of the disk,
 * pulsing on the shared beat.
 *
 * ASSIGNED TECH: deck state (levels / EQ / fader / trackId doubles) + beat.
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
uniform float u_drop;
uniform float u_buildup;
uniform float u_sustain;
uniform float u_centroid;
uniform float u_decay;
uniform float u_seed;
uniform float u_spawn;
uniform float u_spawnSnare;
uniform float u_zoom;
uniform float u_rotStep;
uniform float u_charge;
uniform float u_rippleAge;
uniform float u_rippleAmp;
uniform float u_arms;
uniform float u_fold;
uniform float u_horizonScale;
uniform float u_flash;
uniform float u_phrase;
uniform float u_section;
uniform float u_barWave;
uniform float u_beatPump;
uniform float u_dust;

// ---- DECK MIX (replaces Odyssey's genome cosine palette) ----
uniform vec3 u_deckPrimary;
uniform vec3 u_deckSecondary;
uniform vec3 u_deckAccent;
uniform float u_deckBlend;    // 0 solo … 1 evenly split transition
uniform float u_deckPresence; // total audible energy 0..1
uniform float u_doubles;      // 0..1 doubles lock (twin-core symmetry tell)
uniform float u_twinPulse;    // shared-beat pulse for the doubles tell

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
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return v;
}

// The palette is the deck mix: t sweeps a gradient between the primary and
// secondary audible deck colors, accent lifting the peaks. Presence dims
// toward black when nothing is audible.
vec3 palette(float t) {
  float s = 0.5 - 0.5 * cos(6.28318 * fract(t));
  float split = mix(smoothstep(0.35, 0.65, s), s, 1.0 - u_deckBlend);
  vec3 base = mix(u_deckPrimary, u_deckSecondary, split);
  float peak = pow(s, 2.2);
  vec3 c = mix(base, u_deckAccent, 0.35 * peak);
  c *= 0.55 + 0.55 * (0.4 + 0.6 * s);
  c += (vec3(0.10, -0.02, -0.05) * u_drop - vec3(0.06, 0.02, -0.04) * u_buildup) * u_deckPresence;
  return c * (0.12 + 0.88 * u_deckPresence);
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
  float on = step(gate - 0.09 * gain, hash(sc * 1.618 + 9.7));
  float size = (0.5 + 1.5 * hash(sc.yx * 2.113)) * sizeScale;
  float bright = 0.4 + 0.6 * hash(sc + 17.9);
  vec3 tint = mix(u_deckAccent, u_deckPrimary, hash(sc.yx + 29.3));
  return tint * starShape(f, size) * on * bright * gain;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(c);
  float ang = atan(c.y, c.x);
  float t = u_time;
  vec2 px = 1.0 / u_res;
  float anticipation = smoothstep(0.7, 1.0, u_phrase);

  // ---- Section fold; doubles force an extra 2-segment mirror fold — the
  // visible symmetry tell that two decks share a track.
  vec2 wc = c;
  float foldSeg = max(u_fold, u_doubles > 0.5 ? 2.0 : 0.0);
  if (foldSeg > 0.5) {
    float fold = PI / foldSeg;
    float fa = abs(mod(ang + t * 0.02, 2.0 * fold) - fold);
    wc = vec2(cos(fa), sin(fa)) * r;
  }

  // ---- Warp: differential rotation + churn + kick ripple + lens.
  float rot = u_rotStep * (0.35 + 1.4 * exp(-r * 2.2));
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 w = mat2(cs, -sn, sn, cs) * wc / u_zoom;
  vec2 dirW = r > 1e-4 ? c / r : vec2(0.0);
  vec2 churn = (vec2(
    fbm(c * 2.6 + t * 0.12),
    fbm(c * 2.6 + vec2(7.7, 3.1) - t * 0.09)
  ) - 0.5) * (0.002 + 0.018 * u_mid + 0.012 * u_buildup + 0.006 * u_phrase + 0.006 * anticipation);
  float waveFront = 0.16 + u_rippleAge * 0.9;
  float rippleWave = exp(-pow((r - waveFront) * 9.0, 2.0)) * exp(-u_rippleAge * 2.4) * u_rippleAmp;
  vec2 ripple = dirW * rippleWave * 0.035;
  float barFront = 0.15 + u_barWave * 1.1;
  float barWave = exp(-pow((r - barFront) * 10.0, 2.0)) * exp(-u_barWave * 3.0);
  float horizon = (0.14 + 0.1 * u_low) * u_horizonScale * (1.0 + 0.07 * u_charge)
    * (1.0 + 0.04 * u_phrase * sin(t * 2.3));
  float lens = (0.3 * u_low + 1.15 * u_kick) * (1.0 + 0.7 * u_charge) * exp(-pow(r / horizon, 2.0) * 1.4);
  float drag = lens * 0.12;
  float dcs = cos(drag);
  float dsn = sin(drag);
  w = mat2(dcs, -dsn, dsn, dcs) * w;
  vec2 src = (w + churn + ripple + dirW * barWave * 0.02 + dirW * lens * 0.045)
    / vec2(aspect, 1.0) + 0.5;

  vec2 ab = dirW * (0.0012 + 0.004 * u_drop + 0.003 * u_kick + 0.01 * rippleWave + 0.006 * u_flash)
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

  // ---- Fresh layers. The black-hole heart is tinted by the dominant deck
  // color — the singularity itself carries the audible deck identity.
  vec3 coal = mix(vec3(0.55, 0.07, 0.04), u_deckPrimary * 0.75, 0.55);
  vec3 fresh = vec3(0.0);
  float volt = (noise(vec2(ang * 14.0 + t * 3.0, t * 22.0)) - 0.5)
    + 0.5 * (noise(vec2(ang * 30.0 - t * 5.0, t * 37.0)) - 0.5);
  float bassWarp = u_low * (0.2 * sin(ang * 3.0 + t * 1.7) + 0.13 * sin(ang * 5.0 - t * 2.3))
    + 0.16 * u_kick * sin(ang * 7.0 + t * 9.0)
    + volt * (0.14 * u_low + 0.32 * u_kick);
  float rc = r * (1.0 - bassWarp * exp(-r * 3.0));
  float centerDim = smoothstep(horizon * 0.45, horizon * 1.2, r);
  float heart = exp(-rc * rc * (260.0 - 130.0 * u_kick));
  fresh += mix(coal, u_deckAccent, 0.5 * u_kick) * heart * (0.5 + 1.2 * u_low + 1.4 * u_kick);
  float gravity = sin(rc * 46.0 - t * (3.0 + 9.0 * u_low)) * 0.5 + 0.5;
  fresh += mix(coal, u_deckPrimary, 0.5) * pow(gravity, 4.0) * exp(-r * 5.0)
    * u_low * (0.5 + 0.8 * u_kick);

  // ---- DOUBLES: twin cores flanking the singularity, on the shared beat.
  if (u_doubles > 0.5) {
    float sep = horizon * (1.6 + 0.5 * u_twinPulse);
    vec2 tL = c - vec2(-sep, 0.0);
    vec2 tR = c - vec2(sep, 0.0);
    float twinCore =
      exp(-dot(tL, tL) * (900.0 - 400.0 * u_twinPulse)) +
      exp(-dot(tR, tR) * (900.0 - 400.0 * u_twinPulse));
    vec3 twinColor = mix(u_deckPrimary, u_deckSecondary, 0.5);
    fresh += twinColor * twinCore * u_doubles * (0.6 + 1.4 * u_twinPulse + 0.9 * u_kick);
  }

  // Charged horizon ring: deck color → accent → hot white at full charge.
  float arcJitter = volt * (0.012 + 0.05 * u_kick + 0.022 * u_low);
  float ringGlow = exp(-pow((r - horizon - arcJitter) * 52.0, 2.0));
  float ringCore = exp(-pow((r - horizon - arcJitter) * 210.0, 2.0));
  vec3 chargeColor = mix(u_deckPrimary, u_deckAccent, clamp(u_charge, 0.0, 1.0));
  chargeColor = mix(chargeColor, vec3(1.0, 0.97, 0.92), clamp(u_charge - 0.6, 0.0, 0.4) * 2.5);
  float ringGain = 1.0 + 0.5 * anticipation;
  fresh += chargeColor * ringGlow * (0.12 + 0.6 * u_low + 1.1 * u_kick + 0.5 * u_charge) * ringGain;
  fresh += mix(chargeColor, vec3(1.0), 0.5 * u_kick) * ringCore
    * (0.3 + 1.3 * smoothstep(0.06, 0.3, u_low) + 2.4 * u_kick + 0.8 * u_charge) * ringGain;

  float streak = exp(-abs(c.y) * 110.0) * exp(-abs(c.x) * (4.5 - 1.5 * u_drop));
  fresh += mix(u_deckSecondary, palette(t * 0.02), 0.65) * streak
    * (0.25 + 1.2 * u_low + 0.8 * u_kick);

  // Dust disk in the deck mix.
  float twist = 4.5 + 2.5 * u_phrase;
  float arm = sin(ang * u_arms + log(r + 0.06) * twist - t * (0.06 + 0.14 * u_phrase)
    + 0.5 * u_mid * sin(ang * 3.0 + r * 6.0 + t * 0.7));
  float lanes = pow(0.5 + 0.5 * arm, 3.0) * smoothstep(0.06, 0.2, r) * exp(-r * 1.8);
  float cloudField = fbm(vec2(ang * 2.2 + r * 3.0 - t * 0.15, r * 5.0 + t * 0.06));
  float cloud = pow(cloudField, 2.4);
  vec3 diskColor = palette(cloudField * 1.5 + r * 0.35 + ang * 0.1 + u_centroid * 0.4 + u_phrase * 0.35);
  float reverb = 1.0 + 2.6 * rippleWave + 2.2 * barWave;
  float midGate = smoothstep(0.04, 0.3, u_mid);
  float dustSwell = u_dust * (0.75 + 0.5 * u_phrase);
  fresh += diskColor * lanes * (0.1 + 1.05 * u_mid) * (0.5 + cloud) * dustSwell * centerDim * midGate * reverb;
  fresh += diskColor * cloud * exp(-r * 2.4) * u_mid * 0.45 * dustSwell * centerDim * midGate * reverb;

  // Electric high nebula — accent-forward slice of the mix.
  float wisp = fbm(vec2(ang * 6.0 - t * 0.5, r * 10.0 + t * 0.25));
  float shimmer = 0.6 + 0.4 * sin(t * 13.0 + wisp * 24.0);
  vec3 electric = mix(u_deckAccent, palette(0.6 + t * 0.03), 0.6);
  fresh += electric * pow(wisp, 3.2) * shimmer * smoothstep(0.12, 0.5, r)
    * (0.06 + 1.45 * u_high) * u_dust * reverb;

  // Section omen ring.
  float omen = smoothstep(0.8, 1.0, u_section);
  if (omen > 0.001) {
    float omenR = 1.15 - 0.75 * omen;
    fresh += palette(0.5) * exp(-pow((r - omenR) * 26.0, 2.0)) * omen * 0.8;
  }

  fresh *= 1.0 + 0.12 * anticipation * sin(t * 25.0);
  sky += fresh * (1.0 - u_decay) * (3.0 + 1.2 * u_sustain);

  // ---- Stamps.
  if (u_spawn > 0.01) {
    vec2 sOff = vec2(fract(u_seed * 0.7131) * 21.7, fract(u_seed * 0.3719) * 13.1);
    float puff = pow(fbm(c * 7.0 + sOff), 3.5);
    sky += electric * puff * smoothstep(0.1, 0.4, r) * u_spawn * 0.9;
  }
  if (u_spawnSnare > 0.003) {
    sky += starScatter(c + 11.3, 16.0, 2.8, 0.984, u_spawnSnare * 1.2)
      * smoothstep(0.05, 0.18, r) * mix(vec3(1.0), palette(0.15), 0.45);
  }
  if (u_kick > 0.02) {
    float ringR = 0.1 + 0.05 * u_kick;
    float shock = exp(-pow((r - ringR) * 38.0, 2.0))
      + 0.6 * exp(-pow((r - ringR * 1.7) * 30.0, 2.0));
    sky += mix(coal, u_deckAccent, 0.6) * shock * u_kick * (1.15 + 0.8 * u_drop);
    sky *= 1.0 + 0.1 * u_kick;
  }

  sky += palette(0.4) * u_flash * 0.24 * (1.0 - smoothstep(0.0, 0.9, r));
  sky += (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5) * (0.012 + 0.02 * u_drop);
  vec3 grade = palette(0.35 + u_centroid * 0.2);
  sky = mix(sky, sky * (0.4 + grade * 1.5), 0.24);
  sky *= (0.7 + 0.38 * max(u_drop, u_sustain) - 0.05 * u_buildup) * (1.0 + 0.06 * u_beatPump);

  float m = max(sky.r, max(sky.g, sky.b));
  if (m > 0.8) {
    sky *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}
`;

const ARM_CYCLE = [2, 3, 5];
const FOLD_CYCLE = [0, 6, 8];
/** Warp modes cycled at sections: flight → collapse → orbit. */
const MODE_COUNT = 3;

type Rgb = [number, number, number];

/** '#rrggbb' → [r,g,b] in 0..1 (deck identity color, chroma-true). */
function hexToRgb01(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const DECK_RGB: Record<string, Rgb> = Object.fromEntries(
  Object.entries(DECK_COLORS).map(([deck, hex]) => [deck, hexToRgb01(hex)])
) as Record<string, Rgb>;

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Push a deck color toward its brightest, most-saturated accent. */
function accentOf(rgb: Rgb): Rgb {
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-4);
  const norm: Rgb = [rgb[0] / peak, rgb[1] / peak, rgb[2] / peak];
  return mixRgb(norm, [1, 1, 1], 0.35);
}

/** The audible deck mix, resolved to the three palette colors the shader
 * consumes. Solo → primary === secondary; silence → dim neutral. */
interface DeckMix {
  primary: Rgb;
  secondary: Rgb;
  accent: Rgb;
  blend: number;
  presence: number;
  doubles: number;
}

const NEUTRAL: Rgb = [0.06, 0.06, 0.09];

function resolveDeckMix(active: (DeckStateInfo & { smooth: number })[]): DeckMix {
  if (active.length === 0) {
    return {
      primary: NEUTRAL,
      secondary: NEUTRAL,
      accent: [0.2, 0.2, 0.25],
      blend: 0,
      presence: 0,
      doubles: 0,
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
  return { primary, secondary, accent, blend, presence, doubles };
}

export const g01OdysseyDecksPreset: VisualizerPreset = {
  id: 'g01-odyssey-decks',
  name: 'g01 odyssey-decks',
  hiRes: true,
  params: [
    { id: 'dust', label: 'dust amount', min: 0, max: 2, step: 0.05, default: 1 },
    { id: 'speed', label: 'flight speed', min: 0.2, max: 2.5, step: 0.05, default: 1 },
    { id: 'chaos', label: 'mutation chaos', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    // Odyssey genome state (metric mutations — kept verbatim).
    let armIndex = 0;
    let armsCurrent = ARM_CYCLE[0];
    let foldIndex = 0;
    let modeTarget = 0;
    let modeCurrent = 0;
    let spinDirection = 1;
    let horizonTarget = 1;
    let horizonCurrent = 1;
    let flash = 0;
    let barWaveAge = 99;
    let prevBarIndex: number | null = null;
    let charge = 0;
    let rippleAge = 999;
    let rippleAmp = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let prevDrop = 0;
    let lastDropAt = -99;
    let breakdownS = 0;
    let lastTime = 0;

    // Deck-mix state: per-channel smoothed audible levels + eased palette
    // colors so a transition crossfades the cosmos rather than snapping.
    const levels = new Map<string, number>();
    const primaryCur: Rgb = [...NEUTRAL];
    const secondaryCur: Rgb = [...NEUTRAL];
    const accentCur: Rgb = [0.2, 0.2, 0.25];
    let blendCur = 0;
    let presenceCur = 0;
    let doublesCur = 0;
    let twinPulse = 0;
    let prevDoublesBeatPhase: number | null = null;

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
        const chaos = frame.params.chaos ?? 1;

        // ---- Deck mix (orbit.ts pattern): smooth levels, resolve, ease.
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
        blendCur += (mix.blend - blendCur) * scalarEase;
        presenceCur += (mix.presence - presenceCur) * scalarEase;
        doublesCur += (mix.doubles - doublesCur) * scalarEase;

        // Doubles twin-core pulse on the shared beat.
        if (mix.doubles > 0.5 && beat) {
          if (prevDoublesBeatPhase !== null && beat.phase < prevDoublesBeatPhase) {
            twinPulse = 1;
          }
          prevDoublesBeatPhase = beat.phase;
        } else {
          prevDoublesBeatPhase = null;
        }
        twinPulse = Math.max(0, twinPulse - dt * 3.2);

        // ---- Odyssey genome (metric mutations kept verbatim). ----
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * alpha;
        const sustained = Math.min(1, energy * 1.4);
        const lift = Math.max(smoothDrop, 0.7 * sustained);

        if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastDropAt > 8) {
          lastDropAt = frame.time;
          modeTarget = 0;
          foldIndex = 0;
          horizonTarget = 1.2;
          flash = Math.min(1.4, 1.2 * chaos);
        }
        prevDrop = smoothDrop;
        if (energy < 0.15) breakdownS += dt;
        else breakdownS = 0;
        if (breakdownS > 2.5 && modeTarget !== 2) {
          modeTarget = 2;
          foldIndex = 0;
          flash = Math.max(flash, 0.25 * chaos);
        }

        if (beat) {
          if (prevBarIndex !== null && beat.barIndex !== prevBarIndex) {
            barWaveAge = 0;
            const phraseBoundary = ((beat.barIndex % 4) + 4) % 4 === 0;
            const sectionBoundary = ((beat.barIndex % 16) + 16) % 16 === 0;
            if (phraseBoundary) {
              armIndex = (armIndex + 1) % ARM_CYCLE.length;
              flash = Math.max(flash, 0.6 * chaos);
            }
            if (sectionBoundary) {
              if (lift > 0.5) {
                modeTarget = 0;
                foldIndex = 1 + Math.floor(Math.random() * 2);
              } else {
                modeTarget = (modeTarget + 1) % MODE_COUNT;
                foldIndex = (foldIndex + 1) % FOLD_CYCLE.length;
              }
              spinDirection *= -1;
              horizonTarget = 1 + (Math.random() - 0.35) * 0.6 * chaos;
              flash = Math.min(1.4, 1 * chaos);
            }
          }
          prevBarIndex = beat.barIndex;
        } else {
          prevBarIndex = null;
        }

        const easeFast = 1 - Math.exp(-dt / 0.4);
        armsCurrent += (ARM_CYCLE[armIndex] - armsCurrent) * easeFast;
        modeCurrent += (modeTarget - modeCurrent) * (1 - Math.exp(-dt / 0.9));
        horizonCurrent += (horizonTarget - horizonCurrent) * easeFast;
        flash = Math.max(0, flash - dt * 1.4);
        barWaveAge += dt;
        charge = Math.min(1.4, charge * Math.exp(-dt / 2.5) + frame.impulse.low * 0.28);
        rippleAge += dt;
        if (frame.impulse.low > 0.35 && rippleAge > 0.12) {
          rippleAge = 0;
          rippleAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        const speed = frame.params.speed ?? 1;
        const w0 = Math.max(0, 1 - Math.abs(modeCurrent));
        const w1 = Math.max(0, 1 - Math.abs(modeCurrent - 1));
        const w2 = Math.max(0, 1 - Math.abs(modeCurrent - 2));
        const phraseNow = beat ? ((((beat.barIndex % 4) + 4) % 4) + beat.barPhase) / 4 : 0;
        const zoomFlight =
          1 +
          (0.08 + 0.7 * lift + 3.6 * frame.impulse.low * (0.5 + 0.5 * lift)) *
            (0.85 + 0.3 * phraseNow) * speed * dt;
        const zoomCollapse =
          1 - (0.04 + 0.25 * energy) * speed * dt + 2.2 * frame.impulse.low * speed * dt * 0.5;
        const zoomOrbit = 1 + 0.5 * frame.impulse.low * speed * dt;
        const rotBase = (0.05 + 0.5 * frame.bands.mid + 0.25 * sustained) * speed * dt;

        const phrase = phraseNow;
        const section = beat ? ((((beat.barIndex % 16) + 16) % 16) + beat.barPhase) / 16 : 0;

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_drop: smoothDrop,
          u_buildup: smoothBuildup,
          u_sustain: sustained,
          u_centroid: frame.centroid,
          u_decay: Math.min(0.998, 0.992 - 0.008 * energy - 0.008 * smoothBuildup),
          u_seed: Math.floor(frame.time * 20),
          u_spawn:
            ((Math.min(1, 1.15 * frame.impulse.high + 0.2 * frame.bands.high) *
              (0.4 + 0.6 * Math.max(smoothDrop, sustained))) /
              (1 + 1.8 * smoothBuildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_spawnSnare:
            ((Math.min(1, 0.95 * frame.impulse.mid) *
              (0.5 + 0.5 * Math.max(smoothDrop, sustained))) /
              (1 + 0.8 * smoothBuildup)) /
            (1 + 2.2 * frame.impulse.low),
          u_zoom: w0 * zoomFlight + w1 * zoomCollapse + w2 * zoomOrbit,
          u_rotStep: spinDirection * rotBase * (1 + 2.2 * w2),
          u_charge: charge,
          u_rippleAge: rippleAge,
          u_rippleAmp: rippleAmp,
          u_arms: armsCurrent,
          u_fold: FOLD_CYCLE[foldIndex],
          u_horizonScale: horizonCurrent,
          u_flash: flash,
          u_phrase: phrase,
          u_section: section,
          u_barWave: barWaveAge,
          u_beatPump: beat ? Math.pow(1 - beat.phase, 2) : 0,
          u_dust: frame.params.dust ?? 1,
          u_deckPrimary: [primaryCur[0], primaryCur[1], primaryCur[2]],
          u_deckSecondary: [secondaryCur[0], secondaryCur[1], secondaryCur[2]],
          u_deckAccent: [accentCur[0], accentCur[1], accentCur[2]],
          u_deckBlend: blendCur,
          u_deckPresence: presenceCur,
          u_doubles: doublesCur,
          u_twinPulse: twinPulse,
        };
      },
    });
  },
};

export default g01OdysseyDecksPreset;
