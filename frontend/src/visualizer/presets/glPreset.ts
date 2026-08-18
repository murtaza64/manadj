/**
 * WebGL preset helper (realtime-visualization 05): a fullscreen-quad
 * fragment-shader pipeline so a GL preset is just a shader + a uniform
 * map. Owns a private GL canvas blitted into the layer's 2D context each
 * frame (the morph compositor and preset contract stay canvas-based).
 *
 * Features: uniform cache (floats, vec2/3, float arrays), optional
 * FEEDBACK — ping-pong framebuffer textures with the previous frame bound
 * as `u_prev` (Milkdrop-style trails/advection) — and context-loss
 * parking (GL contexts die on GPU switches/display moves; the preset
 * paints black and rebuilds on restore).
 */

import type { PresetRenderer, VisualizerFrameData } from './types';

export type UniformValue = number | [number, number] | [number, number, number] | Float32Array;

export interface GlPresetSpec {
  /** Fragment source. Receives u_res (vec2) always; with feedback, sample
   * the previous frame from `uniform sampler2D u_prev` at
   * `gl_FragCoord.xy / u_res`. */
  fragment: string;
  /** Per-frame uniforms (u_res is set by the helper). */
  uniforms: (frame: VisualizerFrameData) => Record<string, UniformValue>;
  feedback?: boolean;
}

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** Trivial blit program for presenting the feedback texture. */
const COPY_FRAGMENT = `
precision mediump float;
uniform sampler2D u_prev;
uniform vec2 u_res;
void main() { gl_FragColor = texture2D(u_prev, gl_FragCoord.xy / u_res); }
`;

interface Pipeline {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  copyProgram: WebGLProgram | null;
  locations: Map<string, WebGLUniformLocation>;
  copyLocations: Map<string, WebGLUniformLocation>;
  textures: [WebGLTexture, WebGLTexture] | null;
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer] | null;
  /** Index of the texture holding the PREVIOUS frame. */
  prevIndex: number;
  width: number;
  height: number;
}

function compileProgram(
  gl: WebGLRenderingContext,
  fragment: string
): WebGLProgram | null {
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[glPreset] shader compile failed', gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SRC);
  const frag = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vertex || !frag) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[glPreset] program link failed', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function locationMap(
  gl: WebGLRenderingContext,
  program: WebGLProgram
): Map<string, WebGLUniformLocation> {
  const map = new Map<string, WebGLUniformLocation>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    const location = gl.getUniformLocation(program, info.name);
    if (location) map.set(name, location);
  }
  return map;
}

class GlRenderer implements PresetRenderer {
  private spec: GlPresetSpec;
  private canvas: HTMLCanvasElement;
  private pipeline: Pipeline | null = null;
  private contextLost = false;

  constructor(spec: GlPresetSpec) {
    this.spec = spec;
    this.canvas = document.createElement('canvas');
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.pipeline = null; // rebuild on next frame
    });
  }

  private setup(): Pipeline | null {
    const gl = this.canvas.getContext('webgl');
    if (!gl) return null;
    const program = compileProgram(gl, this.spec.fragment);
    if (!program) return null;
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const bindQuad = (p: WebGLProgram) => {
      const aPos = gl.getAttribLocation(p, 'a_pos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    };
    gl.useProgram(program);
    bindQuad(program);
    let copyProgram: WebGLProgram | null = null;
    if (this.spec.feedback) {
      copyProgram = compileProgram(gl, COPY_FRAGMENT);
      if (!copyProgram) return null;
      // Attribute pointer state is per-index (no VAOs in WebGL1): bind the
      // quad for the copy program too in case its a_pos index differs.
      gl.useProgram(copyProgram);
      bindQuad(copyProgram);
      gl.useProgram(program);
    }
    return {
      gl,
      program,
      copyProgram,
      locations: locationMap(gl, program),
      copyLocations: copyProgram ? locationMap(gl, copyProgram) : new Map(),
      textures: null,
      framebuffers: null,
      prevIndex: 0,
      width: 0,
      height: 0,
    };
  }

  private ensureTargets(p: Pipeline, width: number, height: number): void {
    if (!this.spec.feedback) return;
    if (p.textures && p.width === width && p.height === height) return;
    const { gl } = p;
    if (p.textures) for (const t of p.textures) gl.deleteTexture(t);
    if (p.framebuffers) for (const f of p.framebuffers) gl.deleteFramebuffer(f);
    const make = (): [WebGLTexture, WebGLFramebuffer] => {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return [texture, framebuffer];
    };
    const [t0, f0] = make();
    const [t1, f1] = make();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    p.textures = [t0, t1];
    p.framebuffers = [f0, f1];
    p.prevIndex = 0;
    p.width = width;
    p.height = height;
  }

  private setUniform(
    gl: WebGLRenderingContext,
    location: WebGLUniformLocation,
    value: UniformValue
  ): void {
    if (typeof value === 'number') gl.uniform1f(location, value);
    else if (value instanceof Float32Array) gl.uniform1fv(location, value);
    else if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
    else gl.uniform3f(location, value[0], value[1], value[2]);
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    if (this.contextLost || width < 1 || height < 1) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    if (!this.pipeline) this.pipeline = this.setup();
    const p = this.pipeline;
    if (!p) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const { gl } = p;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ensureTargets(p, width, height);
    gl.viewport(0, 0, width, height);
    gl.useProgram(p.program);

    const resLocation = p.locations.get('u_res');
    if (resLocation) gl.uniform2f(resLocation, width, height);
    const uniforms = this.spec.uniforms(frame);
    for (const [name, value] of Object.entries(uniforms)) {
      const location = p.locations.get(name);
      if (location) this.setUniform(gl, location, value);
    }

    if (this.spec.feedback && p.textures && p.framebuffers) {
      const prev = p.prevIndex;
      const next = 1 - prev;
      // Pass 1: render into `next`, sampling `prev` as u_prev.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, p.textures[prev]);
      const prevLocation = p.locations.get('u_prev');
      if (prevLocation) gl.uniform1i(prevLocation, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.framebuffers[next]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // Pass 2: present `next` to the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(p.copyProgram);
      gl.bindTexture(gl.TEXTURE_2D, p.textures[next]);
      const copyRes = p.copyLocations.get('u_res');
      if (copyRes) gl.uniform2f(copyRes, width, height);
      const copyPrev = p.copyLocations.get('u_prev');
      if (copyPrev) gl.uniform1i(copyPrev, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      p.prevIndex = next;
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    ctx.drawImage(this.canvas, 0, 0);
  }
}

export function createGlRenderer(spec: GlPresetSpec): PresetRenderer {
  return new GlRenderer(spec);
}
