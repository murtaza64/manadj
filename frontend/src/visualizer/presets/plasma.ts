/**
 * "Plasma" preset (realtime-visualization 02/05): kaleidoscopic plasma
 * field on the shared GL pipeline (glPreset.ts). Speaks the waveform band
 * language (waveform/styles.ts ADDITIVE_COLORS): red field = bass, green
 * swirl = mids, blue glints = highs; a white shockwave ring expands with
 * each beat; the kaleidoscope fold count doubles in the back half of the
 * bar. 05: kick impulses now punch the whole field (zoom jolt + flash)
 * so kicks read against sustained bass.
 */

import { ADDITIVE_COLORS } from '../../waveform/styles';
import { energyOf } from '../style';
import { createGlRenderer } from './glPreset';
import type { VisualizerPreset } from './types';

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_energy;
uniform float u_kick;    // low impulse
uniform float u_snare;   // mid impulse
uniform float u_beat;    // beat phase 0..1 (-1 = no grid)
uniform float u_bar;     // bar phase 0..1 (-1 = no grid)

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 MID = ${rgb(ADDITIVE_COLORS[1])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};
const float PI = 3.141592653589793;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  // Kick jolt: the whole field lunges toward the viewer on a transient.
  uv *= 1.0 - 0.12 * u_kick;
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  float seg = (u_bar >= 0.5) ? 12.0 : 6.0;
  float fold = PI / seg;
  a = abs(mod(a + u_time * 0.07, 2.0 * fold) - fold);
  vec2 p = vec2(cos(a), sin(a)) * r;

  float t = u_time;
  float f1 = sin(p.x * 5.0 + t * 1.1) + sin((p.x + p.y) * 4.0 - t * 0.8);
  float lowGlow = (0.5 + 0.5 * sin(f1 * PI * 0.5 + r * 5.0 - t))
    * (1.0 - smoothstep(0.0, 0.85 + 0.5 * u_low, r));
  float f2 = sin(a * seg * 2.0 + r * (9.0 + 6.0 * u_mid) - t * (1.5 + 3.0 * u_mid));
  float midSwirl = pow(0.5 + 0.5 * f2, 3.0);
  float f3 = sin(r * (30.0 + 24.0 * u_high) - t * 6.0 + sin(a * seg * 4.0));
  float highGlint = pow(0.5 + 0.5 * f3, 6.0);

  vec3 col = vec3(0.0);
  col += LOW * lowGlow * (0.25 + 1.3 * u_low);
  col += MID * midSwirl * (0.1 + 1.1 * u_mid) * (1.0 - smoothstep(0.1, 1.2, r));
  col += HIGH * highGlint * (0.06 + 1.2 * u_high);

  if (u_beat >= 0.0) {
    float wave = exp(-45.0 * abs(r - (0.1 + u_beat * 1.1)));
    col += vec3(1.0) * wave * (1.0 - u_beat) * (0.35 + 0.65 * u_low);
  }
  // Snare flash: a brief white lift of the mid ring zone.
  col += MID * u_snare * 0.5 * (1.0 - smoothstep(0.2, 0.9, r));
  col += vec3(1.0) * u_kick * 0.12;

  col *= 1.0 - 0.45 * smoothstep(0.7, 1.5, r);
  col *= 0.75 + 0.5 * u_energy;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

export const plasmaPreset: VisualizerPreset = {
  id: 'plasma',
  hiRes: true,
  name: 'Plasma',
  create: () =>
    createGlRenderer({
      fragment: FRAGMENT,
      uniforms: (frame) => ({
        u_time: frame.time,
        u_low: frame.bands.low,
        u_mid: frame.bands.mid,
        u_high: frame.bands.high,
        u_energy: energyOf(frame.bands),
        u_kick: frame.impulse.low,
        u_snare: frame.impulse.mid,
        u_beat: frame.beat ? frame.beat.phase : -1,
        u_bar: frame.beat ? frame.beat.barPhase : -1,
      }),
    }),
};
