// PROTOTYPE — wipe me. Texture-based waveform renderer for the
// waveform-overhaul prototype (.scratch/waveform-overhaul/PRD.md).
// Answers: do zoom/pan-as-uniforms + tiled data textures + shader-variant
// styles work? All aesthetics are shader parameters; no geometry is ever built.

import type { DecodedWfb, LodPack } from './decodeWfb';
import { TEX_W, MAX_LEVELS } from './decodeWfb';

export interface ProtoParams {
  displayGamma: number; // extra display exponent on de-quantized amplitudes
  master: number; // master amplitude scale
  gains: [number, number, number]; // low/mid/high group gains
  b1: number; // bands [0..b1) = low group
  b2: number; // bands [b1..b2) = mid, [b2..8) = high
  smoothColor: boolean; // interpolate band frames + G's kernel; off = raw 12ms steps
}

// Defaults = user-approved additive-RGB tuning (2026-07-04, see NOTES.md):
// low de-emphasized, highs boosted, low group widened to bands 0-2 (up to 400 Hz).
export const DEFAULT_PARAMS: ProtoParams = {
  displayGamma: 1.0,
  master: 1.0,
  gains: [0.7, 1.05, 1.5],
  b1: 3,
  b2: 5,
  smoothColor: true,
};

const VS = `#version 300 es
const vec2 pos[4] = vec2[4](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
out vec2 v_uv;
void main() {
  v_uv = pos[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}`;

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
uniform float u_playhead; // seconds; < 0 = hidden
uniform float u_smooth;   // 0 = nearest band frame (raw 12ms steps), 1 = interpolated/smoothed
in vec2 v_uv;
out vec4 fragColor;

const vec3 BG = vec3(0.03, 0.03, 0.05);

float fetch1(sampler2D tex, int texel) {
  return texelFetch(tex, ivec2(texel % ${TEX_W}, texel / ${TEX_W}), 0).r;
}
vec4 fetch4(sampler2D tex, int texel) {
  return texelFetch(tex, ivec2(texel % ${TEX_W}, texel / ${TEX_W}), 0);
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

// Hard max over the column's elements. Height stability while scrolling comes
// from pixel-snapping the view origin (see render()): column boundaries stay
// fixed in track-time, so each element permanently owns a column. Weighted
// "antialiasing" of a max is wrong — it makes spike heights pulse.
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

void bands8(float t, out float b[8]) {
  float fps = u_sampleRate / u_bandHop;
  float scale;
  int level = lodLevel(u_visibleSeconds / u_canvasWidth * fps, u_bandLevels, scale);
  int count = u_bandCounts[level];
  float fIdx = (t * u_sampleRate - u_stftWindow * 0.5) / u_bandHop / scale;
  int i = clamp(int(floor(fIdx)), 0, count - 1);
  vec4 lo = fetch4(u_bandLoTex, u_bandOffsets[level] + i);
  vec4 hi = fetch4(u_bandHiTex, u_bandOffsets[level] + i);
  b[0] = amp(lo.r); b[1] = amp(lo.g); b[2] = amp(lo.b); b[3] = amp(lo.a);
  b[4] = amp(hi.r); b[5] = amp(hi.g); b[6] = amp(hi.b); b[7] = amp(hi.a);
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

// Linearly-interpolated band sample (smooth at deep zoom, where frames are ~12ms wide).
void bands8At(float t, out float b[8]) {
  float fps = u_sampleRate / u_bandHop;
  float scale;
  int level = lodLevel(u_visibleSeconds / u_canvasWidth * fps, u_bandLevels, scale);
  int count = u_bandCounts[level];
  float fIdx = (t * u_sampleRate - u_stftWindow * 0.5) / u_bandHop / scale;
  int i0 = clamp(int(floor(fIdx)), 0, count - 1);
  int i1 = min(i0 + 1, count - 1);
  float fr = clamp(fIdx - float(i0), 0.0, 1.0) * u_smooth; // u_smooth=0: nearest frame
  vec4 lo = mix(fetch4(u_bandLoTex, u_bandOffsets[level] + i0),
                fetch4(u_bandLoTex, u_bandOffsets[level] + i1), fr);
  vec4 hi = mix(fetch4(u_bandHiTex, u_bandOffsets[level] + i0),
                fetch4(u_bandHiTex, u_bandOffsets[level] + i1), fr);
  b[0] = amp(lo.r); b[1] = amp(lo.g); b[2] = amp(lo.b); b[3] = amp(lo.a);
  b[4] = amp(hi.r); b[5] = amp(hi.g); b[6] = amp(hi.b); b[7] = amp(hi.a);
}

// Column-integrated band sample: averages every band frame the column spans
// (box filter), so zoomed-out columns show mean energy instead of a random
// point sample — kills beat-rate aliasing ("spiky" zoom-out). Falls back to
// interpolated point sampling when a column is narrower than one frame.
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

// Temporally-smoothed band sample (w = half-width in seconds): rounded Engine-style lobes.
void bands8Smooth(float t, float w, out float b[8]) {
  float a[8]; float c[8]; float d[8];
  bands8At(t - w, a);
  bands8At(t, c);
  bands8At(t + w, d);
  float ws = 0.25 * u_smooth; // u_smooth=0: center tap only
  for (int i = 0; i < 8; i++) b[i] = ws * a[i] + (1.0 - 2.0 * ws) * c[i] + ws * d[i];
}

// Spectral flux: positive band-energy delta over ~60ms, weighted toward upper
// bands. Spikes at onsets (kicks, snares, hats), ~0 during sustained tones.
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
`;

const MAIN = `
void main() {
  float px = u_visibleSeconds / u_canvasWidth;
  float t0 = u_startTime + v_uv.x * u_visibleSeconds;
  if (t0 < 0.0 || t0 > u_duration) { fragColor = vec4(BG * 0.6, 1.0); return; }
  float yA = abs(v_uv.y - 0.5) * 2.0;
  float p = clamp(peakColumn(t0, t0 + px) * u_master, 0.0, 1.0);
  float b[8];
  bands8Column(t0, t0 + px, b); // column-integrated: no point-sample aliasing
  vec3 g = clamp(groupAmps(b), 0.0, 1.0);
  vec3 c = styleColor(yA, p, g, b);
  if (u_playhead >= 0.0 && abs(t0 - u_playhead) < px * 1.25) {
    c = vec3(1.0, 0.25, 0.15); // playhead line
  }
  fragColor = vec4(c, 1.0);
}`;

export interface StyleDef {
  id: string;
  name: string;
  source: string; // styleColor(yA, peak, groups, bands) -> vec3
}

export const STYLES: StyleDef[] = [
  {
    id: 'A',
    name: 'Layered opaque (3Band)',
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = BG;
  if (yA < p) c = vec3(0.15, 0.15, 0.20);          // peak silhouette ghost
  if (yA < g.x) c = vec3(0.08, 0.22, 1.00);         // low: saturated blue
  if (yA < g.y) c = vec3(1.00, 0.56, 0.00);         // mid: amber
  if (yA < g.z) c = vec3(1.00, 1.00, 1.00);         // high: white
  return c;
}`,
  },
  {
    id: 'B',
    name: 'Additive RGB (baseline)',
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = BG;
  if (yA < g.x) c += vec3(1.00, 0.10, 0.10);
  if (yA < g.y) c += vec3(0.00, 1.00, 0.25);
  if (yA < g.z) c += vec3(0.20, 0.45, 1.00);
  return min(c, vec3(1.0));
}`,
  },
  {
    id: 'C',
    name: 'Dominant band',
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  if (yA >= p) return BG;
  vec3 w = g * g * g;
  float sum = w.x + w.y + w.z + 1e-6;
  vec3 c = (w.x * vec3(1.00, 0.15, 0.10)
          + w.y * vec3(0.10, 1.00, 0.25)
          + w.z * vec3(0.25, 0.55, 1.00)) / sum;
  float energy = clamp(max(g.x, max(g.y, g.z)), 0.0, 1.0);
  return c * (0.45 + 0.55 * energy);
}`,
  },
  {
    id: 'D',
    name: 'Spectral hue',
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  if (yA >= p) return BG;
  float num = 0.0;
  float den = 1e-6;
  for (int i = 0; i < 8; i++) { num += float(i) * b[i]; den += b[i]; }
  float spectralCenter = num / den / 7.0;          // 0 = pure bass, 1 = pure air
  float hue = mix(0.0, 0.72, spectralCenter);      // red -> violet-blue
  float total = clamp(den * u_master * 0.6, 0.0, 1.0);
  return hsv2rgb(vec3(hue, 0.95, 0.35 + 0.65 * total));
}`,
  },
  {
    id: 'E',
    name: '8-band stack (+peak lane)',
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  float t = u_startTime + v_uv.x * u_visibleSeconds;
  float fy = v_uv.y * 9.0;
  float fr = fract(fy);
  if (fr < 0.02 || fr > 0.98) return vec3(0.09, 0.09, 0.13);   // lane separator
  int lane = clamp(int(fy), 0, 8);
  float yL = abs(fr - 0.5) * 2.0;
  if (lane == 8) return yL < p ? vec3(0.85) : BG;              // top: broadband peak
  float px = u_visibleSeconds / u_canvasWidth;
  float bb[8];
  bands8Column(t, t + px, bb);
  float h = clamp(bb[lane] * u_master, 0.0, 1.0);              // bottom lane = band 0 (sub)
  vec3 c = hsv2rgb(vec3(mix(0.0, 0.72, float(lane) / 7.0), 0.95, 1.0));
  return yL < h ? c : BG;
}`,
  },
  {
    id: 'F',
    name: '3-group stack',
    source: `
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  float fy = v_uv.y * 3.0;
  float fr = fract(fy);
  if (fr < 0.012 || fr > 0.988) return vec3(0.09, 0.09, 0.13); // lane separator
  int lane = clamp(int(fy), 0, 2);
  float yL = abs(fr - 0.5) * 2.0;
  float h = clamp(lane == 0 ? g.x : lane == 1 ? g.y : g.z, 0.0, 1.0);
  vec3 c = lane == 0 ? vec3(1.00, 0.12, 0.10)                  // bottom: low
         : lane == 1 ? vec3(0.00, 1.00, 0.25)                  // mid
         : vec3(0.20, 0.45, 1.00);                             // top: high
  return yL < h ? c : BG;
}`,
  },
  {
    id: 'G',
    name: 'Engine-ish transient (flux)',
    source: `
// Smoothed low/mid lobes + white spectral-flux wedges at onsets.
// low gain = blue lobe, mid gain = green lobe, high gain = flux sensitivity.
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  float t = u_startTime + v_uv.x * u_visibleSeconds;
  float bs[8];
  bands8Smooth(t, 0.03, bs);
  vec3 gs = groupAmps(bs);
  vec3 c = BG;
  if (yA < clamp(gs.x, 0.0, 1.0)) c = vec3(0.02, 0.30, 1.00);  // engine blue
  if (yA < clamp(gs.y, 0.0, 1.0)) c = vec3(0.00, 0.85, 0.30);  // engine green
  float flux = transientFlux(t) * u_groupGains.z * u_master * 1.6;
  if (yA < clamp(flux, 0.0, 1.0)) c = vec3(0.93, 1.00, 0.97);  // onset wedge
  return c;
}`,
  },
  {
    id: 'H',
    name: 'Additive RGB, peak-edged',
    source: `
// Silhouette height from the peak channel (2.9ms, vertical attacks, no lying);
// band energies only set the *proportions* of the three colors inside it.
// At a fresh attack the band ratios are still ramping -> undefined -> render
// all three (white flash), resolving to true color within ~1 frame.
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  if (yA >= p) return BG;
  float gm = max(g.x, max(g.y, g.z));
  vec3 r = (gm > 0.02) ? clamp(g / gm, 0.0, 1.0) : vec3(1.0);
  vec3 h = r * p;
  vec3 c = BG;
  if (yA < h.x) c += vec3(1.00, 0.10, 0.10);
  if (yA < h.y) c += vec3(0.00, 1.00, 0.25);
  if (yA < h.z) c += vec3(0.20, 0.45, 1.00);
  return min(c, vec3(1.0));
}`,
  },
  {
    id: 'I',
    name: 'Additive RGB + attack ticks',
    source: `
// Style B untouched, plus a 1px bright hairline where the peak channel jumps
// between adjacent columns: transients get an exact, honest onset marker
// without reshaping the color lobes. Ticks fade when zoomed out (columns
// spanning whole beats have no jump between neighbors).
vec3 styleColor(float yA, float p, vec3 g, float b[8]) {
  vec3 c = BG;
  if (yA < g.x) c += vec3(1.00, 0.10, 0.10);
  if (yA < g.y) c += vec3(0.00, 1.00, 0.25);
  if (yA < g.z) c += vec3(0.20, 0.45, 1.00);
  c = min(c, vec3(1.0));
  float t = u_startTime + v_uv.x * u_visibleSeconds;
  float px = u_visibleSeconds / u_canvasWidth;
  float pPrev = clamp(peakColumn(t - px, t) * u_master, 0.0, 1.0);
  float rise = p - pPrev;
  if (rise > 0.15 && yA < p) {
    c = mix(c, vec3(1.0), clamp((rise - 0.15) / 0.25, 0.0, 1.0));
  }
  return c;
}`,
  },
];

interface TexBinding {
  tex: WebGLTexture;
  pack: LodPack;
}

export class ProtoWaveformGL {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private programs = new Map<string, WebGLProgram>();
  private peakTex: TexBinding | null = null;
  private bandLoTex: TexBinding | null = null;
  private bandHiTex: TexBinding | null = null;
  private data: DecodedWfb | null = null;

  styleId = 'A';
  params: ProtoParams = { ...DEFAULT_PARAMS };
  startTime = 0;
  visibleSeconds = 20;
  playhead = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const s of STYLES) {
      this.programs.set(s.id, this.buildProgram(PRELUDE + s.source + MAIN));
    }
  }

  setData(data: DecodedWfb): void {
    this.data = data;
    this.peakTex = this.uploadPack(this.peakTex, data.peaks, 1);
    this.bandLoTex = this.uploadPack(this.bandLoTex, data.bandsLo, 4);
    this.bandHiTex = this.uploadPack(this.bandHiTex, data.bandsHi, 4);
    this.startTime = 0;
    this.visibleSeconds = data.header.duration;
  }

  /** Zoom about a canvas-x fraction [0..1]; view state only — render picks it up. */
  zoomAt(factor: number, xFrac: number): void {
    if (!this.data) return;
    const dur = this.data.header.duration;
    const anchor = this.startTime + xFrac * this.visibleSeconds;
    this.visibleSeconds = Math.min(Math.max(this.visibleSeconds * factor, 0.5), dur);
    this.startTime = anchor - xFrac * this.visibleSeconds;
    this.clampPan();
  }

  panSeconds(dt: number): void {
    this.startTime += dt;
    this.clampPan();
  }

  private clampPan(): void {
    if (!this.data) return;
    const dur = this.data.header.duration;
    const margin = this.visibleSeconds * 0.5;
    this.startTime = Math.min(Math.max(this.startTime, -margin), dur - this.visibleSeconds + margin);
  }

  /** Renders one frame; returns false if there is nothing to draw. */
  render(): boolean {
    const { gl, canvas, data } = this;
    if (!data || !this.peakTex || !this.bandLoTex || !this.bandHiTex) return false;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    const prog = this.programs.get(this.styleId)!;
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

    const hd = data.header;
    // Snap the view origin to whole device pixels: column boundaries stay
    // fixed relative to the data while scrolling, so peak heights are
    // frame-stable (no shimmer/pulsing). Playhead stays unsnapped.
    const spp = this.visibleSeconds / w; // seconds per device pixel
    const snappedStart = Math.floor(this.startTime / spp) * spp;
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
    gl.uniform1f(u('u_playhead'), this.playhead);
    gl.uniform1f(u('u_smooth'), this.params.smoothColor ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  destroy(): void {
    const { gl } = this;
    for (const p of this.programs.values()) gl.deleteProgram(p);
    for (const b of [this.peakTex, this.bandLoTex, this.bandHiTex]) {
      if (b) gl.deleteTexture(b.tex);
    }
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
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (channels === 1) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TEX_W, pack.rows, 0, gl.RED, gl.UNSIGNED_BYTE, pack.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, pack.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, pack.data);
    }
    return { tex, pack };
  }

  private buildProgram(fsSource: string): WebGLProgram {
    const { gl } = this;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`shader compile: ${gl.getShaderInfoLog(sh)}\n${src}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`program link: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }
}
