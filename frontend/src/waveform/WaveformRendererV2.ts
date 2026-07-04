// Production texture-based waveform renderer (ADR 0015).
//
// The waveform body is drawn entirely in a fragment shader over tiled LOD
// data textures (peaks + 8-band matrix, see blob.ts). Zoom, pan, scrub and
// the playhead are uniforms — no geometry is ever built, so cost is
// independent of zoom x duration.
//
// Invariants (ADR 0015 — deliberate, do not "fix"):
// - View origin is pixel-snapped before sampling: column<->bin assignment is
//   frame-stable while scrolling, which is what keeps peak heights steady.
//   Smooth motion belongs to overlays (the playhead stays unsnapped).
// - Per-column aggregation is channel-true: hard max for peaks (envelope),
//   box-filter mean for bands (energy; point-sampling aliases beat patterns
//   into zoom-out spikes; weighted max makes spike heights pulse).
//
// Issue 03 scope: waveform body + playhead + zoom/scrub/click. Beatgrid,
// cue, hot-cue and badge overlays are ported in issue 04.

import type { PlaybackClock } from '../playback/clock';
import type { WebGLRendererConfig } from '../utils/WebGLWaveformRenderer';
import { MAX_LEVELS, TEX_WIDTH } from './blob';
import type { DecodedWaveform, LodPack } from './blob';
import { DEFAULT_PARAMS, DEFAULT_STYLE_ID, getStyle } from './styles';
import type { StyleParams } from './styles';

const MIN_VISIBLE_SECONDS = 1;
const WHEEL_STEP = 1.2;
const DEFAULT_VISIBLE_FRACTION = 1 / 8; // initial zoom: an eighth of the track

const VERTEX_SHADER = `#version 300 es
const vec2 pos[4] = vec2[4](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
out vec2 v_uv;
void main() {
  v_uv = pos[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}`;

// Shared fragment prelude: data access, LOD selection, channel-true column
// aggregation, group math. Style variants append a styleColor() and MAIN.
const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_peakTex;
uniform sampler2D u_bandLoTex;
uniform sampler2D u_bandHiTex;
uniform int u_peakOffsets[${MAX_LEVELS}];
uniform int u_peakCounts[${MAX_LEVELS}];
uniform int u_peakLevels;
uniform int u_bandOffsets[${MAX_LEVELS}];
uniform int u_bandCounts[${MAX_LEVELS}];
uniform int u_bandLevels;
uniform float u_sampleRate;
uniform float u_peakHop;
uniform float u_bandHop;
uniform float u_stftWindow;
uniform float u_duration;
uniform float u_invGamma;
uniform float u_startTime;
uniform float u_visibleSeconds;
uniform float u_canvasWidth;
uniform float u_displayGamma;
uniform float u_master;
uniform vec3 u_groupGains;
uniform ivec2 u_groupBounds;
uniform float u_smooth;
uniform float u_playhead; // seconds; < 0 = hidden
in vec2 v_uv;
out vec4 fragColor;

const vec3 BG = vec3(0.03, 0.03, 0.05);

float fetch1(sampler2D tex, int texel) {
  return texelFetch(tex, ivec2(texel % ${TEX_WIDTH}, texel / ${TEX_WIDTH}), 0).r;
}
vec4 fetch4(sampler2D tex, int texel) {
  return texelFetch(tex, ivec2(texel % ${TEX_WIDTH}, texel / ${TEX_WIDTH}), 0);
}

// Pick the pyramid level so a pixel column covers <= 8 elements.
int lodLevel(float elemsPerPx, int numLevels, out float scale) {
  int level = 0;
  scale = 1.0;
  for (int i = 0; i < ${MAX_LEVELS}; i++) {
    if (level >= numLevels - 1 || elemsPerPx / scale <= 8.0) break;
    level++;
    scale *= 4.0;
  }
  return level;
}

float amp(float v) { return pow(pow(v, u_invGamma), u_displayGamma); }

// Hard max over the column's elements (see pixel-snap invariant above).
float peakColumn(float t0, float t1) {
  float pps = u_sampleRate / u_peakHop;
  float scale;
  int level = lodLevel((t1 - t0) * pps, u_peakLevels, scale);
  int count = u_peakCounts[level];
  int i0 = clamp(int(floor(t0 * pps / scale)), 0, count - 1);
  int i1 = clamp(int(floor(t1 * pps / scale)), i0, min(i0 + 8, count - 1));
  float m = 0.0;
  for (int i = i0; i <= i1; i++) m = max(m, fetch1(u_peakTex, u_peakOffsets[level] + i));
  return amp(m);
}

// Linearly-interpolated band sample at one instant.
void bands8At(float t, out float b[8]) {
  float fps = u_sampleRate / u_bandHop;
  float scale;
  int level = lodLevel(u_visibleSeconds / u_canvasWidth * fps, u_bandLevels, scale);
  int count = u_bandCounts[level];
  float fIdx = (t * u_sampleRate - u_stftWindow * 0.5) / u_bandHop / scale;
  int i0 = clamp(int(floor(fIdx)), 0, count - 1);
  int i1 = min(i0 + 1, count - 1);
  float fr = clamp(fIdx - float(i0), 0.0, 1.0) * u_smooth;
  vec4 lo = mix(fetch4(u_bandLoTex, u_bandOffsets[level] + i0),
                fetch4(u_bandLoTex, u_bandOffsets[level] + i1), fr);
  vec4 hi = mix(fetch4(u_bandHiTex, u_bandOffsets[level] + i0),
                fetch4(u_bandHiTex, u_bandOffsets[level] + i1), fr);
  b[0] = amp(lo.r); b[1] = amp(lo.g); b[2] = amp(lo.b); b[3] = amp(lo.a);
  b[4] = amp(hi.r); b[5] = amp(hi.g); b[6] = amp(hi.b); b[7] = amp(hi.a);
}

// Column-integrated band sample: box-filter mean over the column's frames.
void bands8Column(float t0, float t1, out float b[8]) {
  float fps = u_sampleRate / u_bandHop;
  float scale;
  int level = lodLevel((t1 - t0) * fps, u_bandLevels, scale);
  float x0 = (t0 * u_sampleRate - u_stftWindow * 0.5) / u_bandHop / scale;
  float x1 = (t1 * u_sampleRate - u_stftWindow * 0.5) / u_bandHop / scale;
  if (x1 - x0 < 1.0) {
    bands8At((t0 + t1) * 0.5, b);
    return;
  }
  int count = u_bandCounts[level];
  int i0 = clamp(int(floor(x0)), 0, count - 1);
  int i1 = clamp(int(floor(x1)), i0, min(i0 + 8, count - 1));
  vec4 lo = vec4(0.0);
  vec4 hi = vec4(0.0);
  for (int i = i0; i <= i1; i++) {
    lo += fetch4(u_bandLoTex, u_bandOffsets[level] + i);
    hi += fetch4(u_bandHiTex, u_bandOffsets[level] + i);
  }
  float inv = 1.0 / float(i1 - i0 + 1);
  lo *= inv;
  hi *= inv;
  b[0] = amp(lo.r); b[1] = amp(lo.g); b[2] = amp(lo.b); b[3] = amp(lo.a);
  b[4] = amp(hi.r); b[5] = amp(hi.g); b[6] = amp(hi.b); b[7] = amp(hi.a);
}

// Temporally-smoothed band sample (w = half-width seconds).
void bands8Smooth(float t, float w, out float b[8]) {
  float a[8]; float c[8]; float d[8];
  bands8At(t - w, a);
  bands8At(t, c);
  bands8At(t + w, d);
  float ws = 0.25 * u_smooth;
  for (int i = 0; i < 8; i++) b[i] = ws * a[i] + (1.0 - 2.0 * ws) * c[i] + ws * d[i];
}

// Spectral flux: positive band-energy delta over ~60ms, upper-band weighted.
float transientFlux(float t) {
  float b0[8]; float b1[8];
  bands8At(t, b0);
  bands8At(t - 0.06, b1);
  float f = 0.0;
  for (int i = 0; i < 8; i++) {
    f += max(0.0, b0[i] - b1[i]) * (0.4 + 0.6 * float(i) / 7.0);
  }
  return f;
}

vec3 groupAmps(float b[8]) {
  vec3 g = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float e = b[i] * b[i];
    if (i < u_groupBounds.x) g.x += e;
    else if (i < u_groupBounds.y) g.y += e;
    else g.z += e;
  }
  return sqrt(g) * u_groupGains * u_master;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
`;

const MAIN = `
void main() {
  float px = u_visibleSeconds / u_canvasWidth;
  float t0 = u_startTime + v_uv.x * u_visibleSeconds;
  if (t0 < 0.0 || t0 > u_duration) { fragColor = vec4(BG * 0.6, 1.0); return; }
  float yA = abs(v_uv.y - 0.5) * 2.0;
  float p = clamp(peakColumn(t0, t0 + px) * u_master, 0.0, 1.0);
  float b[8];
  bands8Column(t0, t0 + px, b);
  vec3 g = clamp(groupAmps(b), 0.0, 1.0);
  vec3 c = styleColor(yA, p, g, b);
  if (u_playhead >= 0.0 && abs(t0 - u_playhead) < px * 1.25) {
    c = vec3(1.0, 1.0, 1.0); // playhead line (overlay layer: unsnapped)
  }
  fragColor = vec4(c, 1.0);
}`;

interface TexBinding {
  tex: WebGLTexture;
  pack: LodPack;
}

/**
 * Implements the same interaction surface as the legacy geometry renderer
 * (the useWaveformRenderer hook + WebGLWaveform component contract), so the
 * seam swap is a construction-time choice.
 */
export class WaveformRendererV2 {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private config: WebGLRendererConfig;
  private programs = new Map<string, WebGLProgram>();
  private data: DecodedWaveform | null = null;
  private peakTex: TexBinding | null = null;
  private bandLoTex: TexBinding | null = null;
  private bandHiTex: TexBinding | null = null;

  private styleId = DEFAULT_STYLE_ID;
  private params: StyleParams = { ...DEFAULT_PARAMS };

  private visibleSeconds = 20;
  private lastPlayhead = 0;
  private dragOffsetPx = 0;
  private animationFrame: number | null = null;

  // Stored for issue 04 (overlay port); not yet drawn.
  private cuePoint: number | null = null;
  private hotCues: Array<{ slot_number: number; time_seconds: number; color?: string }> = [];
  private beatTimes: number[] = [];
  private downbeatTimes: number[] = [];

  constructor(canvas: HTMLCanvasElement, config: WebGLRendererConfig = {}) {
    this.canvas = canvas;
    this.config = config;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL 2 not supported');
    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  // ------------------------------------------------------------------ data

  public setWaveformData(data: DecodedWaveform): void {
    this.data = data;
    this.peakTex = this.uploadPack(this.peakTex, data.peaks, 1);
    this.bandLoTex = this.uploadPack(this.bandLoTex, data.bandsLo, 4);
    this.bandHiTex = this.uploadPack(this.bandHiTex, data.bandsHi, 4);
    this.visibleSeconds = Math.max(
      MIN_VISIBLE_SECONDS,
      data.duration * DEFAULT_VISIBLE_FRACTION,
    );
  }

  public setStyle(styleId: string, params?: Partial<StyleParams>): void {
    this.styleId = styleId;
    if (params) this.params = { ...this.params, ...params };
  }

  public setCuePoint(cueTime: number | null): void {
    this.cuePoint = cueTime;
  }

  public setHotCues(
    hotCues: Array<{ slot_number: number; time_seconds: number; color?: string }>,
  ): void {
    this.hotCues = hotCues;
  }

  public setBeatgrid(beatTimes: number[], downbeatTimes: number[]): void {
    this.beatTimes = beatTimes;
    this.downbeatTimes = downbeatTimes;
  }

  /** Overlay data staged for the issue-04 overlay port (not yet drawn). */
  public get overlayState() {
    return {
      cuePoint: this.cuePoint,
      hotCues: this.hotCues,
      beatTimes: this.beatTimes,
      downbeatTimes: this.downbeatTimes,
    };
  }

  // ------------------------------------------------------------- rendering

  public renderFrame(clock: PlaybackClock): void {
    const { gl, canvas, data } = this;
    if (!data || !this.peakTex || !this.bandLoTex || !this.bandHiTex) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    this.lastPlayhead = clock.getPlayhead();
    const marker = this.config.playMarkerPosition ?? 0.25;
    const dragSeconds = (this.dragOffsetPx / (canvas.clientWidth || 1)) * this.visibleSeconds;
    const startTime = this.lastPlayhead - marker * this.visibleSeconds - dragSeconds;

    const prog = this.programFor(this.styleId);
    gl.useProgram(prog);
    const u = (name: string) => gl.getUniformLocation(prog, name);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.peakTex.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bandLoTex.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bandHiTex.tex);
    gl.uniform1i(u('u_peakTex'), 0);
    gl.uniform1i(u('u_bandLoTex'), 1);
    gl.uniform1i(u('u_bandHiTex'), 2);
    this.uploadLod(prog, 'u_peak', this.peakTex.pack);
    this.uploadLod(prog, 'u_band', this.bandLoTex.pack);

    // Pixel-snapped view origin (ADR 0015); playhead uniform stays smooth.
    const spp = this.visibleSeconds / w;
    const snappedStart = Math.floor(startTime / spp) * spp;

    const hd = data.header;
    gl.uniform1f(u('u_sampleRate'), hd.sampleRate);
    gl.uniform1f(u('u_peakHop'), hd.peakHop);
    gl.uniform1f(u('u_bandHop'), hd.bandHop);
    gl.uniform1f(u('u_stftWindow'), hd.stftWindow);
    gl.uniform1f(u('u_duration'), hd.duration);
    gl.uniform1f(u('u_invGamma'), 1 / hd.gamma);
    gl.uniform1f(u('u_startTime'), snappedStart);
    gl.uniform1f(u('u_visibleSeconds'), this.visibleSeconds);
    gl.uniform1f(u('u_canvasWidth'), w);
    gl.uniform1f(u('u_displayGamma'), this.params.displayGamma);
    gl.uniform1f(u('u_master'), this.params.master);
    gl.uniform3f(u('u_groupGains'), ...this.params.gains);
    gl.uniform2i(u('u_groupBounds'), this.params.b1, this.params.b2);
    gl.uniform1f(u('u_smooth'), this.params.smooth ? 1 : 0);
    gl.uniform1f(u('u_playhead'), this.lastPlayhead);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Self-driving convenience: renderFrame on an own rAF loop. */
  public startRenderLoop(clock: PlaybackClock): void {
    const loop = () => {
      this.renderFrame(clock);
      this.animationFrame = requestAnimationFrame(loop);
    };
    this.animationFrame = requestAnimationFrame(loop);
  }

  public stopRenderLoop(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  // ----------------------------------------------------------- interaction

  public setVisibleSeconds(seconds: number): void {
    if (!this.data) return;
    this.visibleSeconds = Math.min(
      Math.max(seconds, MIN_VISIBLE_SECONDS),
      this.data.duration,
    );
  }

  public zoomIn(): void {
    this.setVisibleSeconds(this.visibleSeconds / WHEEL_STEP);
  }

  public zoomOut(): void {
    this.setVisibleSeconds(this.visibleSeconds * WHEEL_STEP);
  }

  public handleWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) this.zoomIn();
    else this.zoomOut();
  }

  /** Shift the visible content by a pixel delta (CSS pixels) during a drag. */
  public setDragOffset(pixels: number): void {
    this.dragOffsetPx = pixels;
  }

  /**
   * End a drag: return the seek time the drag corresponds to (undefined if
   * no data). Drag right = move backward in time. The renderer never seeks;
   * the component hands this to the transport.
   */
  public commitDrag(): number | undefined {
    if (!this.data) return undefined;
    const dragSeconds =
      (this.dragOffsetPx / (this.canvas.clientWidth || 1)) * this.visibleSeconds;
    this.dragOffsetPx = 0;
    const seekTime = this.lastPlayhead - dragSeconds;
    return Math.max(0, Math.min(this.data.duration, seekTime));
  }

  /** Click-to-seek: the track time under the pointer. */
  public handleClick(event: MouseEvent): number | undefined {
    if (!this.data) return undefined;
    const rect = this.canvas.getBoundingClientRect();
    const frac = (event.clientX - rect.left) / rect.width;
    const marker = this.config.playMarkerPosition ?? 0.25;
    const startTime = this.lastPlayhead - marker * this.visibleSeconds;
    const t = startTime + frac * this.visibleSeconds;
    return Math.max(0, Math.min(this.data.duration, t));
  }

  // --------------------------------------------------------------- cleanup

  public dispose(): void {
    this.stopRenderLoop();
    const { gl } = this;
    for (const p of this.programs.values()) gl.deleteProgram(p);
    this.programs.clear();
    for (const b of [this.peakTex, this.bandLoTex, this.bandHiTex]) {
      if (b) gl.deleteTexture(b.tex);
    }
    this.peakTex = this.bandLoTex = this.bandHiTex = null;
  }

  // -------------------------------------------------------------- internals

  private programFor(styleId: string): WebGLProgram {
    let prog = this.programs.get(styleId);
    if (!prog) {
      prog = this.buildProgram(PRELUDE + getStyle(styleId).source + MAIN);
      this.programs.set(styleId, prog);
    }
    return prog;
  }

  private uploadLod(prog: WebGLProgram, prefix: string, pack: LodPack): void {
    const { gl } = this;
    const offs = new Int32Array(MAX_LEVELS);
    const counts = new Int32Array(MAX_LEVELS);
    offs.set(pack.levelOffsets);
    counts.set(pack.levelCounts);
    gl.uniform1iv(gl.getUniformLocation(prog, `${prefix}Offsets`), offs);
    gl.uniform1iv(gl.getUniformLocation(prog, `${prefix}Counts`), counts);
    gl.uniform1i(gl.getUniformLocation(prog, `${prefix}Levels`), pack.numLevels);
  }

  private uploadPack(prev: TexBinding | null, pack: LodPack, channels: 1 | 4): TexBinding {
    const { gl } = this;
    if (prev) gl.deleteTexture(prev.tex);
    const tex = gl.createTexture();
    if (!tex) throw new Error('waveform: failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (channels === 1) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TEX_WIDTH, pack.rows, 0, gl.RED, gl.UNSIGNED_BYTE, pack.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_WIDTH, pack.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, pack.data);
    }
    return { tex, pack };
  }

  private buildProgram(fsSource: string): WebGLProgram {
    const { gl } = this;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) throw new Error('waveform: failed to create shader');
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`waveform shader compile: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const prog = gl.createProgram();
    if (!prog) throw new Error('waveform: failed to create program');
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`waveform program link: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }
}
