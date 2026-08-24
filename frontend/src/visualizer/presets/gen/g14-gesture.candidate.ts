/**
 * g14-gesture (gen-14 NOVEL — waveform resurrection). Fossil
 * g03-scope-ribbon ("not very responsive to music") read only for the
 * autopsy; raids g06-calligraphy (alive, +1) for the wantsWave plumbing
 * (per-channel wave uniforms, feedback page, soft knee).
 *
 * RESPONSIVE FIRST — the design inverts scope-ribbon's failure:
 * - The triggered mono waveform IS the geometry at full scale, drawn as
 *   one thick luminous stroke along a phrase-quantized writing axis.
 *   JS runs a rising-edge zero-cross trigger BEFORE downsampling
 *   (scope's phase-stability trick the ribbon skipped).
 * - Motion verbs, one per band, all deterministic and global:
 *   KICK  = SLAM (amplitude punch ×(1+1.8·env), nib thickens, shock ring
 *           stamped into the page from center; ~0.15 s decay),
 *   SNARE = SPLIT (stroke tears into its L/R stereo pair for a ~0.4 s
 *           settle + edge fray),
 *   HATS  = GLINTS (specks at wave crests, ~0.12 s — sizzle, not dust).
 * - A BPM-locked highlight sweeps the stroke with beat.phase.
 * - NO u_time in any motion term: only envelopes, beat phase, and
 *   integrators. (The ribbon's coil/knot/taper all rode wall clock.)
 * - Null-wave fallback synthesizes from band-weighted sines: never blank.
 *
 * Feedback page: advection along the axis, unsharp tap, decay ≤ 0.955,
 * injection ×(1−decay), chroma-preserving soft knee. Photosafety: kick
 * lift ≤ 8% full-field; ring/glints localized.
 */

import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

/** Per-channel samples handed to GLSL as uniform float[WAVE_N]. */
const WAVE_N = 96;

const FRAGMENT = `
precision highp float;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_slam;      // kick punch envelope (fast decay)
uniform float u_split;     // snare stereo-split envelope
uniform float u_glintEnv;  // hat crest-glint envelope
uniform float u_beatPhase; // 0..1 meter-locked sweep
uniform float u_axis;      // writing axis angle (phrase-quantized, eased)
uniform float u_amp;       // wave scale (param x drop echo)
uniform float u_weight;    // nib thickness
uniform float u_drop;
uniform float u_buildup;
uniform float u_ringAge;
uniform float u_ringAmp;
uniform float u_palPhase;  // ink phase (genome + phrase step)
uniform float u_warm;      // centroid EMA
uniform float u_decay;
uniform float u_advect;    // page advection along the axis
uniform float u_vibrato;   // bands.high micro-vibrato (buildup aliveness)
uniform float u_waveM[96];
uniform float u_waveL[96];
uniform float u_waveR[96];

const float TWO_PI = 6.28318530718;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Constant-loop lookup (GLSL ES 1.0 forbids dynamic array indexing).
float waveMAt(int i) { float v = 0.0; for (int k = 0; k < 96; k++) { if (k == i) v = u_waveM[k]; } return v; }
float waveLAt(int i) { float v = 0.0; for (int k = 0; k < 96; k++) { if (k == i) v = u_waveL[k]; } return v; }
float waveRAt(int i) { float v = 0.0; for (int k = 0; k < 96; k++) { if (k == i) v = u_waveR[k]; } return v; }

vec3 ink(float t) {
  vec3 c = vec3(0.5) + vec3(0.55) * cos(TWO_PI * (vec3(1.0, 0.85, 0.7) * t
    + vec3(0.0, 0.3, 0.62) + u_palPhase));
  return max(c + vec3(0.10, 0.02, -0.08) * (u_warm - 0.5) + vec3(0.08, 0.01, -0.06) * u_drop, vec3(0.0));
}

// Sample one wave channel (0 mono, 1 left, 2 right) at along in [0,1].
float sampleWave(int chan, float along) {
  float fpos = clamp(along, 0.0, 1.0) * 95.0;
  int i0 = int(floor(fpos));
  int i1 = i0 + 1 > 95 ? 95 : i0 + 1;
  float f = fract(fpos);
  float a; float b;
  if (chan == 0) { a = waveMAt(i0); b = waveMAt(i1); }
  else if (chan == 1) { a = waveLAt(i0); b = waveLAt(i1); }
  else { a = waveRAt(i0); b = waveRAt(i1); }
  return mix(a, b, f);
}

// Coverage of a stroke whose lateral offset is the wave, centered at
// baseOff from the axis. Returns intensity; outputs the wave value.
float stroke(float along, float lateral, float baseOff, int chan, float nib, out float wv) {
  wv = sampleWave(chan, along);
  float amp = u_amp * (1.0 - 0.45 * u_buildup);
  float y = baseOff + wv * amp + u_vibrato * 0.006 * sin(along * 210.0);
  float d = abs(lateral - y);
  float core = exp(-pow(d / max(nib, 1e-4), 2.0));
  float halo = exp(-d * 14.0) * 0.35;
  return core + halo;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float r = length(p);

  vec2 axis = vec2(cos(u_axis), sin(u_axis));
  vec2 normal = vec2(-axis.y, axis.x);
  // Parametric position along the writing axis, [0,1] across the screen.
  float along = clamp(dot(p, axis) / (0.62 * (aspect + 1.0)) + 0.5, 0.0, 1.0);
  float lateral = dot(p, normal);

  // ---- Feedback page: advect ALONG the axis (gesture echo), unsharp tap.
  vec2 px = 1.0 / u_res;
  vec2 src = uv - axis * u_advect / vec2(aspect, 1.0);
  vec3 page = texture2D(u_prev, src).rgb;
  vec3 blur = (texture2D(u_prev, src + vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src - vec2(px.x, 0.0)).rgb
    + texture2D(u_prev, src + vec2(0.0, px.y)).rgb
    + texture2D(u_prev, src - vec2(0.0, px.y)).rgb) * 0.25;
  page = max(vec3(0.0), page * 1.22 - blur * 0.22) * u_decay;

  // ---- The gesture. Nib: weight + low band + kick slam thickening.
  float nib = (0.014 + 0.03 * u_low + 0.035 * u_slam) * u_weight;
  float slamAmp = 1.0 + 1.8 * u_slam;

  vec3 fresh = vec3(0.0);
  float wv;
  if (u_split < 0.03) {
    // Mono stroke (the resting state).
    float sMono = stroke(along, lateral / slamAmp, 0.0, 0, nib, wv);
    vec3 col = ink(along * 0.9 + wv * 0.5);
    fresh += col * sMono * (0.55 + 0.7 * u_low + 0.9 * u_slam);
    // Drop echo pair: harmonic offset copies, held on the plateau.
    if (u_drop > 0.1) {
      float wv2;
      float sE1 = stroke(along, lateral / slamAmp, 0.16, 0, nib * 0.6, wv2);
      float sE2 = stroke(along, lateral / slamAmp, -0.16, 0, nib * 0.6, wv2);
      fresh += ink(along * 0.9 + 0.35) * (sE1 + sE2) * 0.4 * u_drop;
    }
  } else {
    // SNARE SPLIT: the stroke tears into its stereo pair.
    float sep = 0.05 + 0.22 * u_split;
    float wvL; float wvR;
    float sL = stroke(along, lateral / slamAmp, sep, 1, nib * 0.8, wvL);
    float sR = stroke(along, lateral / slamAmp, -sep, 2, nib * 0.8, wvR);
    // Edge fray: serration keyed to per-fragment hash during the split.
    float fray = 1.0 + 0.5 * u_split * (hash(p * 240.0) - 0.5);
    fresh += ink(along * 0.9 + wvL * 0.5) * sL * (0.5 + 0.8 * u_mid) * fray;
    fresh += ink(along * 0.9 + wvR * 0.5 + 0.3) * sR * (0.5 + 0.8 * u_mid) * fray;
    wv = (wvL + wvR) * 0.5;
  }

  // ---- BPM-locked highlight: a bright packet at beat.phase along the
  // stroke (meter-locked speed — never energy, never wall clock).
  float sweep = exp(-pow((along - u_beatPhase) * 7.0, 2.0));
  float nearStroke = exp(-abs(lateral / slamAmp - wv * u_amp * (1.0 - 0.45 * u_buildup)) * 30.0);
  fresh += ink(u_beatPhase + 0.5) * sweep * nearStroke * (0.3 + 0.5 * u_low);

  // ---- Hat glints: specks at wave CRESTS (|w| large), fast decay.
  float crest = smoothstep(0.45, 0.85, abs(wv));
  float speck = step(0.86, hash(floor(p * 90.0) + floor(u_beatPhase * 4.0)));
  fresh += vec3(1.0, 0.95, 0.85) * crest * speck * nearStroke * u_glintEnv * 2.2;

  // ---- Kick shock ring stamped into the page (global, deterministic).
  float front = 0.08 + u_ringAge * 1.5;
  float ring = exp(-pow((r - front) * 8.0, 2.0)) * exp(-u_ringAge * 2.8) * u_ringAmp;
  fresh += ink(0.1) * ring * 0.9;

  vec3 col = page + fresh * (1.0 - u_decay) * 5.0;
  // Kick lift: small full-field punch (≤ 8%).
  col *= 1.0 + 0.08 * u_slam;

  // Chroma-preserving soft knee.
  float m = max(col.r, max(col.g, col.b));
  if (m > 0.84) {
    col *= (0.84 + 0.16 * (1.0 - exp(-(m - 0.84) * 3.0))) / m;
  }
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

/** splitmix32-style scalar hash → stable [0,1). */
function splitmix(n: number): number {
  let x = (n | 0) + 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
}

/** Rising-edge zero-cross trigger (scope's phase-stability trick): find
 * the first upward crossing in the front half so the trace holds still. */
function triggerOffset(mono: Float32Array): number {
  const half = mono.length >> 1;
  for (let i = 1; i < half; i++) {
    if (mono[i - 1] <= 0 && mono[i] > 0) return i;
  }
  return 0;
}

const candidate: VisualizerPreset = {
  id: 'g14-gesture',
  name: 'g14 gesture',
  hiRes: true,
  wantsWave: true,
  params: [
    { id: 'amp', label: 'wave scale', min: 0.5, max: 2, step: 0.05, default: 1.2 },
    { id: 'weight', label: 'nib weight', min: 0.5, max: 2, step: 0.05, default: 1 },
    { id: 'trails', label: 'page persistence', min: 0.4, max: 1.6, step: 0.05, default: 1 },
    { id: 'slam', label: 'kick slam', min: 0.4, max: 2, step: 0.05, default: 1.2 },
  ],
  create: () => {
    let lastTime = 0;
    const waveM = new Float32Array(WAVE_N);
    const waveL = new Float32Array(WAVE_N);
    const waveR = new Float32Array(WAVE_N);
    let slam = 0;
    let split = 0;
    let glint = 0;
    let ringAge = 999;
    let ringAmp = 0;
    let axisTarget = 0.6;
    let axisNow = 0.6;
    let lastPhrase = -1;
    let lastSection = -1;
    let palStep = 0;
    let smoothDrop = 0;
    let smoothBuildup = 0;
    let warm = 0.5;
    let synthPhase = 0;
    let genomeKey = -1;
    let inkBase = 0;
    let gridlessClock = 0;
    return createGlRenderer({
      fragment: FRAGMENT,
      feedback: true,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0.0001, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;

        // Genome ink per dominant track.
        let dom: (typeof frame.decks)[number] | null = null;
        for (const d of frame.decks) {
          if (d.playing && (dom === null || d.level > dom.level)) dom = d;
        }
        const key = dom?.trackId ?? 0;
        if (key !== genomeKey) {
          genomeKey = key;
          inkBase = splitmix(key);
        }

        // ---- Wave intake: trigger THEN downsample (phase-stable trace).
        const w = frame.wave;
        if (w && w.left.length > 0) {
          const n = w.left.length;
          const mono = new Float32Array(n);
          for (let i = 0; i < n; i++) mono[i] = (w.left[i] + w.right[i]) * 0.5;
          const off = triggerOffset(mono);
          const span = n - off;
          for (let i = 0; i < WAVE_N; i++) {
            const j = off + Math.floor((i / (WAVE_N - 1)) * (span - 1));
            waveM[i] = mono[j];
            waveL[i] = w.left[j];
            waveR[i] = w.right[j];
          }
        } else {
          // Null-wave fallback: band-weighted sines — never blank.
          synthPhase += dt * (2.0 + 3.0 * (frame.bandsSlow ?? frame.bands).mid);
          for (let i = 0; i < WAVE_N; i++) {
            const t = i / (WAVE_N - 1);
            waveM[i] =
              0.4 * frame.bands.low * Math.sin(t * 6.28318 * 2 + synthPhase) +
              0.25 * frame.bands.mid * Math.sin(t * 6.28318 * 5 + synthPhase * 1.7) +
              0.12 * frame.bands.high * Math.sin(t * 6.28318 * 11 + synthPhase * 2.3);
            waveL[i] = waveM[i] * 1.1;
            waveR[i] = waveM[i] * 0.9;
          }
        }

        // Trend split (~0.35 s, kit law).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const smoothAlpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * smoothAlpha;
        smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - smoothBuildup) * smoothAlpha;
        const energyNow = (frame.bands.low + frame.bands.mid + frame.bands.high) / 3;
        const lift = Math.max(smoothDrop, Math.min(1, energyNow * 1.4));
        warm += (frame.centroid - warm) * (1 - Math.exp(-dt / 1.0));

        // ---- The three verbs (fast envelopes; deterministic, global).
        slam = Math.max(slam * Math.exp(-dt / 0.15),
          Math.min(1, frame.impulse.low * (frame.params.slam ?? 1.2)));
        split = Math.max(split * Math.exp(-dt / 0.4), Math.min(1, frame.impulse.mid * 1.15));
        glint = Math.max(glint * Math.exp(-dt / 0.12), Math.min(1, frame.impulse.high * 1.2));
        ringAge += dt;
        if (frame.impulse.low > 0.35 && ringAge > 0.12) {
          ringAge = 0;
          ringAmp = Math.min(1, frame.impulse.low * 1.2);
        }

        // ---- Meter clocks (never wall clock).
        let bar: number;
        let beatPhase: number;
        if (frame.beat) {
          bar = frame.beat.ladderBarIndex ?? frame.beat.barIndex;
          beatPhase = frame.beat.phase;
        } else {
          gridlessClock += dt;
          bar = Math.floor(gridlessClock / 2);
          beatPhase = (gridlessClock * 2) % 1;
        }
        const phrase = Math.floor(bar / 4);
        const section = Math.floor(bar / 16);
        if (phrase !== lastPhrase && lastPhrase >= 0) {
          axisTarget += 0.35 + splitmix(phrase * 13 + genomeKey) * 0.5;
          palStep += 0.13;
        }
        lastPhrase = phrase;
        if (section !== lastSection && lastSection >= 0) {
          axisTarget += 0.9 + splitmix(section * 29 + genomeKey) * 1.1;
          palStep += 0.31;
        }
        lastSection = section;
        axisNow += (axisTarget - axisNow) * (1 - Math.exp(-dt / 0.4));

        // Page persistence: contractive (≤ 0.955), advect along axis on
        // bandsSlow (τ built into the band itself).
        const motion = frame.bandsSlow ?? frame.bands;
        const trails = frame.params.trails ?? 1;
        const decay = Math.min(0.955, 1 - 0.06 / trails);

        return {
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_slam: slam,
          u_split: split,
          u_glintEnv: glint,
          u_beatPhase: beatPhase,
          u_axis: axisNow,
          u_amp: 0.22 * (frame.params.amp ?? 1.2),
          u_weight: frame.params.weight ?? 1,
          u_drop: Math.max(smoothDrop, 0.6 * lift),
          u_buildup: smoothBuildup,
          u_ringAge: ringAge,
          u_ringAmp: ringAmp,
          u_palPhase: inkBase + palStep,
          u_warm: warm,
          u_decay: decay,
          u_advect: (0.001 + 0.004 * motion.mid) * (1 + smoothDrop),
          u_vibrato: frame.bands.high * (0.4 + 0.6 * smoothBuildup),
          u_waveM: waveM,
          u_waveL: waveL,
          u_waveR: waveR,
        };
      },
    });
  },
};

export default candidate;
