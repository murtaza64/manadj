/**
 * "g02 plasma-theatre" (tweak of g00-plasma): plasma's kaleidoscopic
 * band-RGB field (red = bass, green swirl = mids, blue glints = highs)
 * plus the white beat shockwave — now staged as SECTION THEATRE.
 *
 * The fold count / mirror phase is a REGIME driven from JS: it jumps
 * dramatically at 16-bar section boundaries through a cycle
 *   fold 6 → fold 12 → UNFOLDED → fold 8
 * each jump swaps the palette regime (which band leads the grade) and
 * fires a white sweep that washes across the field. Within a regime,
 * PHRASE phase (4-bar) modulates continuously: the fold seam softens and
 * the swirl rate lifts toward the phrase boundary. Regime targets are
 * eased toward on the JS side (odyssey genome pattern) so the section
 * jump reads as a shove, not a cut.
 *
 * Spectral shape steers the interference: spread → field softness/blur
 * (wide sound = soft glow, narrow = crisp), flatness → grain vs smooth
 * (noisy = film grain over the field, tonal = clean interference).
 *
 * frame.beat may be null: without a grid the regime cannot ride bar
 * lines, so it advances on DROP detections instead (a landing drop kicks
 * the fold cycle forward, swaps palette, sweeps), and the phrase phase
 * free-runs on a slow clock.
 */

import { ADDITIVE_COLORS } from '../../../waveform/styles';
import { energyOf } from '../../style';
import { createGlRenderer } from '../glPreset';
import type { VisualizerPreset } from '../types';

const rgb = (c: readonly [number, number, number]) =>
  'vec3(' + c[0].toFixed(3) + ', ' + c[1].toFixed(3) + ', ' + c[2].toFixed(3) + ')';

const FRAGMENT = [
  'precision highp float;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform float u_low;',
  'uniform float u_mid;',
  'uniform float u_high;',
  'uniform float u_energy;',
  'uniform float u_kick;    // low impulse',
  'uniform float u_snare;   // mid impulse',
  'uniform float u_beat;    // beat phase 0..1 (-1 = no grid)',
  'uniform float u_seg;     // eased regime fold count (0 = unfolded)',
  'uniform float u_phrase;  // phrase phase 0..1 (modulation within regime)',
  'uniform float u_palette; // eased regime palette id (0..2)',
  'uniform float u_sweep;   // white section-sweep age (>=0 active, <0 idle)',
  'uniform float u_spread;  // 0 narrow .. 1 full-spectrum -> field softness',
  'uniform float u_flatness;// 0 tonal .. 1 noisy -> grain amount',
  '',
  'const vec3 LOW = ' + rgb(ADDITIVE_COLORS[0]) + ';',
  'const vec3 MID = ' + rgb(ADDITIVE_COLORS[1]) + ';',
  'const vec3 HIGH = ' + rgb(ADDITIVE_COLORS[2]) + ';',
  'const float PI = 3.141592653589793;',
  '',
  'float hash(vec2 p) {',
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
  '}',
  '',
  'void main() {',
  '  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);',
  '  // Kick jolt: the whole field lunges toward the viewer on a transient.',
  '  uv *= 1.0 - 0.12 * u_kick;',
  '  float r = length(uv);',
  '  float a = atan(uv.y, uv.x);',
  '',
  '  // Phrase modulation: swirl rate lifts and the fold seam softens as',
  '  // the phrase closes in on its boundary.',
  '  float phraseLift = 0.5 + 0.5 * u_phrase;',
  '  float swirlRate = 0.05 + 0.06 * phraseLift;',
  '',
  '  // Regime fold: u_seg eased; below 1 the field is UNFOLDED (no mirror).',
  '  float seg = max(u_seg, 1.0);',
  '  float fold = PI / seg;',
  '  float folded = abs(mod(a + u_time * swirlRate, 2.0 * fold) - fold);',
  '  // Soften the seam near phrase boundaries: relax the mirror toward the',
  '  // raw angle so the reflection edge blurs as the phrase closes.',
  '  float seamSoft = 0.35 * u_phrase;',
  '  folded = mix(folded, a + u_time * swirlRate, seamSoft);',
  '  float unfoldMix = clamp(1.0 - u_seg, 0.0, 1.0);',
  '  float useA = mix(folded, a + u_time * swirlRate, unfoldMix);',
  '  vec2 p = vec2(cos(useA), sin(useA)) * r;',
  '',
  '  float t = u_time;',
  '  // Spread widens the interference kernels (soft field) as it rises.',
  '  float soft = 0.5 + 1.5 * u_spread;',
  '  float f1 = sin(p.x * (5.0 / soft) + t * 1.1)',
  '    + sin((p.x + p.y) * (4.0 / soft) - t * 0.8);',
  '  float lowGlow = (0.5 + 0.5 * sin(f1 * PI * 0.5 + r * 5.0 - t))',
  '    * (1.0 - smoothstep(0.0, 0.85 + 0.5 * u_low, r));',
  '  float f2 = sin(useA * seg * 2.0 + r * (9.0 + 6.0 * u_mid)',
  '    - t * (1.5 + 3.0 * u_mid) * phraseLift);',
  '  float midSwirl = pow(0.5 + 0.5 * f2, 3.0);',
  '  float f3 = sin(r * (30.0 + 24.0 * u_high) - t * 6.0 + sin(useA * seg * 4.0));',
  '  float highGlint = pow(0.5 + 0.5 * f3, 6.0);',
  '',
  '  vec3 col = vec3(0.0);',
  '  col += LOW * lowGlow * (0.25 + 1.3 * u_low);',
  '  col += MID * midSwirl * (0.1 + 1.1 * u_mid) * (1.0 - smoothstep(0.1, 1.2, r));',
  '  col += HIGH * highGlint * (0.06 + 1.2 * u_high);',
  '',
  '  // Palette REGIME: which band leads the grade rotates per section.',
  '  // p0 bass-forward, p1 mid-forward, p2 high-forward. Eased mix.',
  '  float pw0 = max(0.0, 1.0 - abs(u_palette - 0.0));',
  '  float pw1 = max(0.0, 1.0 - abs(u_palette - 1.0));',
  '  float pw2 = max(0.0, 1.0 - abs(u_palette - 2.0));',
  '  vec3 grade = pw0 * (LOW * 1.3 + MID * 0.5 + HIGH * 0.4)',
  '    + pw1 * (MID * 1.3 + HIGH * 0.5 + LOW * 0.4)',
  '    + pw2 * (HIGH * 1.3 + LOW * 0.5 + MID * 0.4);',
  '  col = mix(col, col * (0.55 + grade * 1.2), 0.35);',
  '',
  '  // Beat shockwave (kept from plasma).',
  '  if (u_beat >= 0.0) {',
  '    float wave = exp(-45.0 * abs(r - (0.1 + u_beat * 1.1)));',
  '    col += vec3(1.0) * wave * (1.0 - u_beat) * (0.35 + 0.65 * u_low);',
  '  }',
  '  // Snare flash: a brief white lift of the mid ring zone.',
  '  col += MID * u_snare * 0.5 * (1.0 - smoothstep(0.2, 0.9, r));',
  '  col += vec3(1.0) * u_kick * 0.12;',
  '',
  '  // Section white sweep: a bright band travels outward on a regime jump.',
  '  if (u_sweep >= 0.0) {',
  '    float front = -0.15 + u_sweep * 1.6;',
  '    float sweep = exp(-pow((r - front) * 4.5, 2.0)) * (1.0 - u_sweep);',
  '    col += vec3(1.0) * sweep * 0.9;',
  '  }',
  '',
  '  // Flatness: noisy material grains the field; tonal stays smooth.',
  '  float grain = (hash(gl_FragCoord.xy + fract(t) * 191.0) - 0.5)',
  '    * (0.02 + 0.16 * u_flatness);',
  '  col += grain * (0.3 + 0.7 * (col.r + col.g + col.b));',
  '',
  '  col *= 1.0 - 0.45 * smoothstep(0.7, 1.5, r);',
  '  col *= 0.75 + 0.5 * u_energy;',
  '',
  '  // Chroma-preserving soft knee.',
  '  float m = max(col.r, max(col.g, col.b));',
  '  if (m > 0.8) {',
  '    col *= (0.8 + 0.2 * (1.0 - exp(-(m - 0.8) * 3.0))) / m;',
  '  }',
  '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
  '}',
].join('\n');

/** Regime fold cycle: 6 → 12 → unfolded (0) → 8. */
const FOLD_CYCLE = [6, 12, 0, 8];
const PALETTE_COUNT = 3;
const mod = (n: number, m: number) => ((n % m) + m) % m;

export const g02PlasmaTheatrePreset: VisualizerPreset = {
  id: 'g02-plasma-theatre',
  name: 'g02 plasma-theatre',
  hiRes: true,
  params: [
    { id: 'theatre', label: 'section drama', min: 0, max: 2, step: 0.05, default: 1 },
  ],
  create: () => {
    let lastTime = 0;
    let prevBarIndex: number | null = null;
    // Regime state machine (odyssey pattern: JS targets + eased currents).
    let foldIndex = 0;
    let segTarget = FOLD_CYCLE[0];
    let segCurrent = FOLD_CYCLE[0];
    let paletteTarget = 0;
    let paletteCurrent = 0;
    let sweep = -1; // <0 idle; runs 0..1 when a section jump fires.
    // Gridless: regimes advance on drop detections, phrase free-runs.
    let smoothDrop = 0;
    let prevDrop = 0;
    let lastJumpAt = -99;
    let freePhrase = 0;

    const advanceRegime = (drama: number) => {
      foldIndex = mod(foldIndex + 1, FOLD_CYCLE.length);
      segTarget = FOLD_CYCLE[foldIndex];
      paletteTarget = mod(paletteTarget + 1, PALETTE_COUNT);
      sweep = 0; // fire the white sweep
      // Drama scales how hard the ease snaps by pre-biasing the current.
      segCurrent += (segTarget - segCurrent) * 0.25 * Math.min(1, drama);
    };

    return createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => {
        const dt = lastTime > 0 ? Math.min(0.1, Math.max(0, frame.time - lastTime)) : 1 / 60;
        lastTime = frame.time;
        const beat = frame.beat;
        const energy = energyOf(frame.bands);
        const drama = frame.params.theatre ?? 1;

        // Drop tracking (for gridless regime advance).
        const lowPresence = Math.min(1, Math.max(0, (frame.bands.low - 0.2) / 0.5));
        const alpha = 1 - Math.exp(-dt / 0.35);
        smoothDrop += (frame.trend.excitement * lowPresence - smoothDrop) * alpha;

        let phrase: number;
        if (beat && beat.barIndex !== null) {
          // Grid present: section boundaries (16-bar) jump the regime,
          // phrase phase is the 4-bar position.
          if (prevBarIndex !== null && beat.barIndex !== prevBarIndex) {
            if (mod(beat.barIndex, 16) === 0) advanceRegime(drama);
          }
          prevBarIndex = beat.barIndex;
          phrase = (mod(beat.barIndex, 4) + beat.barPhase) / 4;
        } else {
          prevBarIndex = null;
          // Gridless: a landing drop advances the regime (debounced).
          if (smoothDrop > 0.45 && prevDrop <= 0.45 && frame.time - lastJumpAt > 6) {
            lastJumpAt = frame.time;
            advanceRegime(drama);
          }
          // Free-running phrase clock (~one phrase every 8s), lifted by energy.
          freePhrase = mod(freePhrase + dt * (0.12 + 0.12 * energy), 1);
          phrase = freePhrase;
        }
        prevDrop = smoothDrop;

        // Ease the regime toward its targets.
        const easeSlow = 1 - Math.exp(-dt / 0.7);
        segCurrent += (segTarget - segCurrent) * easeSlow;
        paletteCurrent += (paletteTarget - paletteCurrent) * easeSlow;
        // Advance / retire the white sweep.
        if (sweep >= 0) {
          sweep += dt * (0.7 + 0.4 * drama);
          if (sweep > 1) sweep = -1;
        }

        return {
          u_time: frame.time,
          u_low: frame.bands.low,
          u_mid: frame.bands.mid,
          u_high: frame.bands.high,
          u_energy: energy,
          u_kick: frame.impulse.low,
          u_snare: frame.impulse.mid,
          u_beat: frame.beat ? frame.beat.phase : -1,
          u_seg: segCurrent,
          u_phrase: phrase,
          u_palette: paletteCurrent,
          u_sweep: sweep,
          u_spread: frame.spread,
          u_flatness: frame.flatness,
        };
      },
    });
  },
};

export default g02PlasmaTheatrePreset;
