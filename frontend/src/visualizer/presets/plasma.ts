/**
 * "Plasma" preset (realtime-visualization 02): the first WebGL preset — a
 * fullscreen fragment shader (kaleidoscopic plasma field) that canvas 2D
 * cannot afford per-pixel. The renderer owns a private WebGL canvas and
 * blits it into its layer's 2D context each frame, so the morph
 * compositor and the preset contract stay untouched.
 *
 * Speaks the waveform band language (waveform/styles.ts ADDITIVE_COLORS):
 * the red field is the bass, the green swirl the mids, the blue glints
 * the highs; a white shockwave ring expands with each beat phase and the
 * kaleidoscope fold count doubles on the downbeat half of the bar.
 * Context loss is handled by parking until restore (GL contexts die on
 * GPU switches / display moves — a canvas-2D preset never does; this is
 * the tradeoff preset).
 */

import { ADDITIVE_COLORS } from '../../waveform/styles';
import { energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const rgb = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const FRAGMENT_SRC = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_low;
uniform float u_mid;
uniform float u_high;
uniform float u_energy;
uniform float u_beat;    // beat phase 0..1 (-1 = no grid)
uniform float u_bar;     // bar phase 0..1 (-1 = no grid)

const vec3 LOW = ${rgb(ADDITIVE_COLORS[0])};
const vec3 MID = ${rgb(ADDITIVE_COLORS[1])};
const vec3 HIGH = ${rgb(ADDITIVE_COLORS[2])};
const float PI = 3.141592653589793;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Kaleidoscope fold: 6 segments, 12 in the back half of the bar.
  float seg = (u_bar >= 0.5) ? 12.0 : 6.0;
  float fold = PI / seg;
  a = abs(mod(a + u_time * 0.07, 2.0 * fold) - fold);
  vec2 p = vec2(cos(a), sin(a)) * r;

  float t = u_time;
  // Bass field: slow red plasma, amplitude and reach ride the low band.
  float f1 = sin(p.x * 5.0 + t * 1.1) + sin((p.x + p.y) * 4.0 - t * 0.8);
  float lowGlow = (0.5 + 0.5 * sin(f1 * PI * 0.5 + r * 5.0 - t))
    * (1.0 - smoothstep(0.0, 0.85 + 0.5 * u_low, r));
  // Mid swirl: green interference bands spiraling with the mids.
  float f2 = sin(a * seg * 2.0 + r * (9.0 + 6.0 * u_mid) - t * (1.5 + 3.0 * u_mid));
  float midSwirl = pow(0.5 + 0.5 * f2, 3.0);
  // High glints: fine blue rings shimmering with the highs.
  float f3 = sin(r * (30.0 + 24.0 * u_high) - t * 6.0 + sin(a * seg * 4.0));
  float highGlint = pow(0.5 + 0.5 * f3, 6.0);

  vec3 col = vec3(0.0);
  col += LOW * lowGlow * (0.25 + 1.3 * u_low);
  col += MID * midSwirl * (0.1 + 1.1 * u_mid) * (1.0 - smoothstep(0.1, 1.2, r));
  col += HIGH * highGlint * (0.06 + 1.2 * u_high);

  // Beat shockwave: a bright ring expanding over the beat, fading as it goes.
  if (u_beat >= 0.0) {
    float wave = exp(-45.0 * abs(r - (0.1 + u_beat * 1.1)));
    col += vec3(1.0) * wave * (1.0 - u_beat) * (0.35 + 0.65 * u_low);
  }

  // Vignette + energy lift.
  col *= 1.0 - 0.45 * smoothstep(0.7, 1.5, r);
  col *= 0.75 + 0.5 * u_energy;
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const UNIFORMS = ['u_res', 'u_time', 'u_low', 'u_mid', 'u_high', 'u_energy', 'u_beat', 'u_bar'] as const;
type UniformName = (typeof UNIFORMS)[number];

class PlasmaRenderer implements PresetRenderer {
  private glCanvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private uniforms = new Map<UniformName, WebGLUniformLocation>();
  private contextLost = false;

  constructor() {
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    this.glCanvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.gl = null; // rebuild the pipeline on next frame
    });
    this.setup();
  }

  private setup(): boolean {
    const gl = this.glCanvas.getContext('webgl');
    if (!gl) return false;
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[Plasma] shader compile failed', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SRC);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vertex || !fragment) return false;
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[Plasma] program link failed', gl.getProgramInfoLog(program));
      return false;
    }
    gl.useProgram(program);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.uniforms.clear();
    for (const name of UNIFORMS) {
      const location = gl.getUniformLocation(program, name);
      if (location) this.uniforms.set(name, location);
    }
    this.gl = gl;
    return true;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    if (this.contextLost) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (!this.gl && !this.setup()) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const gl = this.gl!;
    if (this.glCanvas.width !== width || this.glCanvas.height !== height) {
      this.glCanvas.width = width;
      this.glCanvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const set = (name: UniformName, value: number) => {
      const location = this.uniforms.get(name);
      if (location) gl.uniform1f(location, value);
    };
    const resLocation = this.uniforms.get('u_res');
    if (resLocation) gl.uniform2f(resLocation, width, height);
    set('u_time', frame.time);
    set('u_low', frame.bands.low);
    set('u_mid', frame.bands.mid);
    set('u_high', frame.bands.high);
    set('u_energy', energyOf(frame.bands));
    set('u_beat', frame.beat ? frame.beat.phase : -1);
    set('u_bar', frame.beat ? frame.beat.barPhase : -1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.drawImage(this.glCanvas, 0, 0);
  }
}

export const plasmaPreset: VisualizerPreset = {
  id: 'plasma',
  name: 'Plasma',
  create: () => new PlasmaRenderer(),
};
