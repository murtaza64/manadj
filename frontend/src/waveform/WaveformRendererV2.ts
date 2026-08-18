// Production texture-based waveform renderer (ADR 0015).
//
// The waveform body is drawn entirely in a fragment shader over tiled LOD
// data textures (peaks + 8-band matrix, see blob.ts). Zoom, pan, scrub and
// windowing are uniforms — no geometry is ever built for the body, so cost
// is independent of zoom x duration.
//
// Invariants (ADR 0015 — deliberate, do not "fix"):
// - View origin is pixel-snapped before sampling: column<->bin assignment is
//   frame-stable while scrolling, which is what keeps peak heights steady.
//   Smooth motion belongs to the overlay pass (playhead, markers).
// - Per-column aggregation is channel-true: hard max for peaks (envelope),
//   box-filter mean for bands (energy; point-sampling aliases beat patterns
//   into zoom-out spikes; weighted max makes spike heights pulse).
//
// Overlays (beatgrid, Main cue, Hot Cues, playhead, badge/time canvas) are a
// separate vertex-geometry pass ported from the legacy geometry renderer.

import type { PlaybackClock } from '../playback/clock';
import { addBeats } from '../playback/quantize';
import { MAX_LEAD_IN_SECONDS } from '../playback/DeckEngine';
import { barCountLabel } from '../meter/ladder';
import { HOT_CUE_CSS_COLORS } from '../hotcues/palette';
import { STEP_RATIO } from '../utils/waveformZoom';
import { playedDimBoundary } from './loopOverlay';
import { MAX_LEVELS, TEX_WIDTH } from './blob';
import type { DecodedWaveform, LodPack } from './blob';
import { DEFAULT_PARAMS, DEFAULT_STYLE_ID, getStyle } from './styles';
import type { StyleParams } from './styles';

export interface WaveformRendererConfig {
  isMinimapMode?: boolean;
  /** Position of the fixed playhead in follow mode (0.0-1.0, default 0.25). */
  playMarkerPosition?: number;
  /** Draw a time/bar readout on the overlay canvas (main waveform only). */
  showTimeReadout?: boolean;
  /** Where the time/bar readout sits (default 'bottom-right'). */
  timeReadoutAnchor?: 'bottom-right' | 'top-left';
  /** CSS-px offset for the 'top-left' readout — lets a caller tuck it
   * under its DOM overlays (the library player's transport panel). */
  timeReadoutOffset?: { x: number; y: number };
  /** Scale waveform band colors only (0-1, default 1) — markers stay
   * full-strength (transition-editor rows use ~0.6). */
  waveformBrightness?: number;
  /** Where the amplitude baseline sits (default 'center'). 'top'/'bottom'
   * draw half-waveforms growing from that edge at double amplitude (the
   * editor's stacked rows). Minimap mode is always bottom-anchored. */
  amplitudeAnchor?: 'center' | 'top' | 'bottom';
}

/** Per-column visual modulation from drawn automation (transition-editor
 * rows): as a function of TRACK time, `gain` scales bar height (fader) and
 * `low`/`mid`/`high` scale each group's color (EQ). */
export type WaveformModulation = (trackTimeSec: number) => {
  gain: number;
  low: number;
  mid: number;
  high: number;
};

const MIN_VISIBLE_SECONDS = 1;
/** Idle-poll cadence for the self-driven loop when paused and unchanged —
 * matches the in-repo motion clocks (DawTimeline, usePlayGuides). */
const IDLE_TICK_MS = 250;
// one zoom sensitivity everywhere: utils/waveformZoom owns the constant
const WHEEL_STEP = STEP_RATIO;
const DEFAULT_VISIBLE_SECONDS = 20;
const MOD_TEX_WIDTH = 1024;
/** Modulation values are encoded /2 into uint8 so EQ boosts up to 2x survive. */
const MOD_RANGE = 2;

function formatReadoutTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** Hot-cue slot FALLBACK palette (hotcue-colors 01): bright, fully
 * saturated — the pastel Catppuccin set was rejected. A cue's STORED
 * color (Engine import) takes precedence at every render site; these are
 * what colorless (in-app-created) cues get. Mirrors --hc-1..--hc-8 in
 * styles/variables.css (the GL pass can't read CSS vars — keep in sync).
 * Also reused by the Set overview ladder (sets 04 review). */
const CUE_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** CSS-side cue color resolution (hotcue-colors 01): the stored per-cue
 * color wins when it's a trustworthy hex; otherwise the slot palette.
 * Shared by every 2D canvas/DOM render site (editor lane guides, editor
 * minimap) so no surface grows its own fallback. */
/**
 * Which beat indices are downbeats — epsilon matching, not exact floats
 * (ADR 0027 §8). Both arrays are sorted; a two-pointer sweep. The backend
 * appends the same accumulated float to both arrays today, but if either
 * side ever derived independently, exact `Set.has` matching would silently
 * drop EVERY beat line at zoomed-out levels. ε = 1μs: float-noise scale,
 * orders of magnitude below any beat interval.
 */
export function matchDownbeatIndices(
  beatTimes: readonly number[],
  downbeatTimes: readonly number[]
): Set<number> {
  const tiers = matchBeatTiers(beatTimes, downbeatTimes, null);
  const indices = new Set<number>();
  for (let i = 0; i < tiers.length; i++) if (tiers[i] >= 0) indices.add(i);
  return indices;
}

/**
 * Per-beat Metric-ladder tier (metric-ladder 01): beat index → the tier of
 * that downbeat (`tiers` is parallel to `downbeatTimes`), or −1 for a weak
 * beat. The epsilon two-pointer sweep `matchDownbeatIndices` is now sugar
 * over; with no tiers every downbeat is tier 0 (plain bar — the legacy
 * two-tier look).
 */
export function matchBeatTiers(
  beatTimes: readonly number[],
  downbeatTimes: readonly number[],
  tiers: readonly number[] | null
): Int8Array {
  const EPS = 1e-6;
  const out = new Int8Array(beatTimes.length).fill(-1);
  let j = 0;
  for (let i = 0; i < beatTimes.length; i++) {
    while (j < downbeatTimes.length && downbeatTimes[j] < beatTimes[i] - EPS) j++;
    if (j < downbeatTimes.length && Math.abs(downbeatTimes[j] - beatTimes[i]) <= EPS) {
      out[i] = tiers ? (tiers[j] ?? 0) : 0;
    }
  }
  return out;
}

/** The slice of a LadderProjection the renderer consumes (metric-ladder
 * 01/03): per-downbeat tiers, counts, and parenthetical flags, plus each
 * tier's bar span — everything is read from the projection, never
 * re-derived from a duple assumption. */
export interface LadderGridInput {
  tiers: readonly number[];
  tierBars: readonly number[];
  barIndexes: readonly number[];
  parentheticals: readonly boolean[];
  parentheticalCounts: readonly number[];
  topBars: readonly number[];
}

/** Metric-ladder gridline styling: width (dpr multiples) and alpha per
 * tier, index 0 = bar … 4 = 16-bar boundary. Tier 0 keeps the legacy
 * downbeat look; higher tiers escalate so phrase structure reads at a
 * glance at any zoom. Tunable heuristics, not part of the model. */
export const TIER_WIDTH: readonly number[] = [2, 2, 2.5, 3, 3.5];
export const TIER_ALPHA: readonly number[] = [0.3, 0.38, 0.48, 0.6, 0.75];
/** A tier's lines draw only when that tier's own spacing is at least this
 * many px (dpr-scaled): zoomed out, low tiers cull and only phrase-level
 * lines survive — the generalization of the legacy 2.5px/bar cutoff. */
export const TIER_MIN_SPACING_PX = 2.5;

/** '#RRGGBB' → 0-1 floats; null for anything else (falls back to the
 * slot palette — stored colors are Engine-import hex, but don't trust). */
function parseCueColor(color: string | null | undefined): [number, number, number] | null {
  if (!color || !CUE_COLOR_RE.test(color)) return null;
  return [
    parseInt(color.slice(1, 3), 16) / 255,
    parseInt(color.slice(3, 5), 16) / 255,
    parseInt(color.slice(5, 7), 16) / 255,
  ];
}

/** Reset-mark indicator color (metric-ladder 02): gold — outside the hot
 * cue palette, warmer than the grey gridlines. */
const RESET_MARK_COLOR: [number, number, number] = [1.0, 0.82, 0.4];

/** Playhead pink (var(--pink)) — shared by the playhead bar and the
 * beatjump target guides, which are playhead-relative by meaning. */
const PLAYHEAD_COLOR: [number, number, number] = [0.96, 0.76, 0.91];

/** GL-side palette: the CSS palette as 0-1 floats. */
const HOT_CUE_COLORS: Record<number, [number, number, number]> = Object.fromEntries(
  Object.entries(HOT_CUE_CSS_COLORS).map(([slot, hex]) => [slot, parseCueColor(hex)!]),
);

const BODY_VERTEX_SHADER = `#version 300 es
const vec2 pos[4] = vec2[4](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
out vec2 v_uv;
void main() {
  v_uv = pos[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
}`;

const BODY_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_peakTex;
uniform sampler2D u_bandLoTex;
uniform sampler2D u_bandHiTex;
uniform sampler2D u_modTex;
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
uniform float u_coreWhite;
uniform float u_coreBloom;
uniform vec3 u_colorLow;
uniform vec3 u_colorMid;
uniform vec3 u_colorHigh;
uniform int u_anchor;      // 0 center, 1 top, 2 bottom
uniform float u_brightness; // body colors only; markers are a separate pass
uniform float u_modEnabled;
uniform float u_modStart;  // track-seconds range covered by u_modTex
uniform float u_modSpan;
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

// Hard max over the column's elements (pixel-snap invariant, ADR 0015).
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

// Column-integrated band sample: box-filter mean (ADR 0015).
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

// Soft-knee limiter: exactly linear below the knee, asymptotic to 1 above.
// Tames spiky post-gain group heights (hats/snares at gain 1.5 otherwise pin
// to full height and bury markers) without dimming the body.
float softLimit(float x) {
  const float knee = 0.6;
  return x <= knee ? x : knee + (1.0 - knee) * (1.0 - exp(-(x - knee) / (1.0 - knee)));
}

vec3 groupAmps(float b[8]) {
  vec3 g = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float e = b[i] * b[i];
    if (i < u_groupBounds.x) g.x += e;
    else if (i < u_groupBounds.y) g.y += e;
    else g.z += e;
  }
  vec3 gained = sqrt(g) * u_groupGains;
  return vec3(softLimit(gained.x), softLimit(gained.y), softLimit(gained.z)) * u_master;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
`;

const BODY_MAIN = `
void main() {
  float px = u_visibleSeconds / u_canvasWidth;
  float t0 = u_startTime + v_uv.x * u_visibleSeconds;
  if (t0 < 0.0 || t0 > u_duration) { fragColor = vec4(BG * 0.6, 1.0); return; }
  // Amplitude coordinate: mirrored (center) or edge-anchored half-waveforms.
  float yA = u_anchor == 0 ? abs(v_uv.y - 0.5) * 2.0
           : u_anchor == 1 ? 1.0 - v_uv.y
           : v_uv.y;
  float p = clamp(peakColumn(t0, t0 + px) * u_master, 0.0, 1.0);
  float b[8];
  bands8Column(t0, t0 + px, b);
  vec3 g = groupAmps(b);
  if (u_modEnabled > 0.5) {
    vec4 m = texture(u_modTex, vec2((t0 - u_modStart) / u_modSpan, 0.5)) * float(${MOD_RANGE});
    g *= m.rgb * m.a;
    p *= m.a;
  }
  g = clamp(g, 0.0, 1.0);
  vec3 c = styleColor(yA, p, g, b);
  fragColor = vec4(BG + (c - BG) * u_brightness, 1.0);
}`;

// Overlay pass: plain position+color triangles in pixel space (ported from
// the legacy renderer). u_offsetPx translates beatgrid vertices, which are
// built in time-anchored pixel space so scrolling never rebuilds them.
const OVERLAY_VS = `#version 300 es
in vec2 a_position;
in vec3 a_color;
uniform mat4 u_matrix;
uniform float u_offsetPx;
out vec3 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_position.x + u_offsetPx, a_position.y, 0.0, 1.0);
  v_color = a_color;
}`;

const OVERLAY_FS = `#version 300 es
precision mediump float;
in vec3 v_color;
uniform float u_alpha;
out vec4 outColor;
void main() { outColor = vec4(v_color, u_alpha); }`;

interface TexBinding {
  tex: WebGLTexture;
  pack: LodPack;
}

/**
 * A shaded track-time region for the overlay pass (looping 05) — the
 * renderer's general filled-region primitive (active loop today; manual
 * loop in/out and Saved loops reuse it). Fill and edges draw additively,
 * so the waveform body stays readable underneath; minimaps render the
 * region as a thin band instead of a full-height fill.
 */
export interface OverlayRegion {
  /** Track-time bounds in seconds. */
  start: number;
  end: number;
  /** 0..1 RGB. */
  color: [number, number, number];
  /** Fill strength (additive: the color is scaled by this). */
  fillAlpha: number;
  /** Draw solid edge lines at the bounds (full waveforms only). */
  edges?: boolean;
}

/** The view actually rendered this frame (one source of truth for overlays). */
interface FrameView {
  startTime: number;
  visibleSeconds: number;
  playhead: number;
  w: number;
  h: number;
  dpr: number;
}

/** One spliced strip of the canvas (transition-takes 06): the DAW-splice
 * rendering for Jump events. Body draws with viewport+scissor into the
 * strip (per-segment pixel-snap — ADR 0015 applies per strip); overlays
 * draw full-viewport through a time-shifted view under the same scissor,
 * keeping the beatgrid vertex cache stable across segments. */
export interface DisplaySegment {
  /** Canvas x-range, as fractions of the canvas width. */
  x0Frac: number;
  x1Frac: number;
  /** Track window (normalized track positions, like setDisplayWindow). */
  first: number;
  last: number;
  /** Whether the playhead marker belongs to this segment. Replayed
   * content contains the same track time twice — the CALLER knows which
   * instance is under the mix playhead. */
  drawPlayhead: boolean;
  /** Optional modulation-domain remap: the modulation callback is invoked
   * with `offset + trackTime × scale` instead of raw track time (the
   * editor feeds mix-domain envelopes in segmented mode — track time is
   * ambiguous across replayed segments). */
  modAffine?: { offset: number; scale: number };
}

export class WaveformRendererV2 {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private config: WaveformRendererConfig;
  private isMinimap: boolean;
  private anchor: 'center' | 'top' | 'bottom';
  private brightness: number;

  private programs = new Map<string, WebGLProgram>();
  private data: DecodedWaveform | null = null;
  private peakTex: TexBinding | null = null;
  private bandLoTex: TexBinding | null = null;
  private bandHiTex: TexBinding | null = null;

  private styleId = DEFAULT_STYLE_ID;
  private params: StyleParams = { ...DEFAULT_PARAMS };

  private visibleSeconds = DEFAULT_VISIBLE_SECONDS;
  private lastPlayhead = 0;
  private animationFrame: number | null = null;

  // Self-driven loop gating (performance-hardening 01): the loop drops to a
  // 250ms idle poll when nothing that feeds a frame changed and the playhead
  // is still, and sleeps entirely while the owning view is hidden. Mutators
  // set `dirty`; playhead motion is detected against `lastPlayhead`. The
  // `driven` path (DawTimeline's own motion clock) never enters here.
  private idleTimer: number | null = null;
  private dirty = true;
  private active = true;
  private playing = false;
  /** The clock the self-driven loop reads; retained so setActive can
   * restart the loop on re-activation. Null for the `driven` path. */
  private clock: PlaybackClock | null = null;
  /** The running loop's tick, so markDirty can pull a parked idle poll
   * forward. Non-null only while a self-driven loop is active. */
  private scheduledTick: (() => void) | null = null;

  // Externally-set window (DAW timeline), as normalized track positions.
  private externalWindow = false;
  private windowStart = 0;
  private windowEnd = 1;
  // Spliced strips (transition-takes 06); non-null overrides the window.
  private displaySegments: DisplaySegment[] | null = null;

  // Modulation (transition-editor rows).
  private modulation: WaveformModulation | null = null;
  private modTex: WebGLTexture | null = null;
  private modScratch = new Uint8Array(MOD_TEX_WIDTH * 4);

  // Overlay pass state.
  private overlayProgram: WebGLProgram | null = null;
  private overlayVao: WebGLVertexArrayObject | null = null;
  private overlayBuffer: WebGLBuffer | null = null;
  private beatgridVao: WebGLVertexArrayObject | null = null;
  private beatgridBuffer: WebGLBuffer | null = null;
  private beatgridCache: { key: string; vertexCount: number } | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private cuePoint: number | null = null;
  /** Reset-mark positions (downbeat-resolved seconds, metric-ladder 02). */
  private resetMarks: number[] = [];
  private dropMarks: Array<{ time: number; strength: number }> = [];
  /** Per-mark beatline width multiplier (CSS px), lazily matched to the
   * beat tier under each mark; null = recompute (marks or grid changed). */
  private dropMarkWidthMul: number[] | null = null;
  /** Beatjump size (beats) for target guides; null hides them. */
  private beatjumpBeats: number | null = null;
  /** Plain-array view of beatTimes for beat-domain math (addBeats). */
  private beatTimesPlain: readonly number[] | null = null;
  private regions: OverlayRegion[] = [];
  private hotCues = new Map<number, { time: number; color?: string | null }>();
  private beatTimes: Float32Array | null = null;
  private downbeatTimes: Float32Array | null = null;
  /** Beat index → Metric-ladder tier (−1 = weak beat); parallel to beatTimes. */
  private beatTiers: Int8Array | null = null;
  /** Bars per tier-k group, from the ladder projection ([1] = tier-0 only). */
  private tierBars: readonly number[] = [1];
  /** The full ladder projection slice (counts + parentheticals, 03). */
  private ladder: LadderGridInput | null = null;

  constructor(canvas: HTMLCanvasElement, config: WaveformRendererConfig = {}) {
    this.canvas = canvas;
    this.config = config;
    this.isMinimap = config.isMinimapMode ?? false;
    this.anchor = this.isMinimap ? 'bottom' : (config.amplitudeAnchor ?? 'center');
    // Minimap dims the body (legacy parity) so markers pop; markers stay full.
    this.brightness =
      Math.max(0, Math.min(1, config.waveformBrightness ?? 1)) * (this.isMinimap ? 0.55 : 1);
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL 2 not supported');
    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.initOverlayPass();
  }

  // ------------------------------------------------------------------ data

  /** Wake the self-driven loop for one frame (performance-hardening 01):
   * every mutator that changes what a frame draws calls this so an idle
   * renderer repaints immediately instead of after the next idle poll. If
   * the loop is currently parked on its idle timer, pull the next frame
   * forward to rAF so the change shows on the very next frame (seek/zoom/
   * play must never wait out the 250ms poll). No-op for the `driven` path,
   * which never enters the idle branch. */
  public markDirty(): void {
    this.dirty = true;
    // Parked on the idle timer (not rAF, and the loop is running/active):
    // cancel it and run now. `scheduledTick` is set only while a loop runs.
    if (this.active && this.idleTimer !== null && this.scheduledTick) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
      this.animationFrame = requestAnimationFrame(this.scheduledTick);
    }
  }

  public setWaveformData(data: DecodedWaveform): void {
    this.data = data;
    this.peakTex = this.uploadPack(this.peakTex, data.peaks, 1);
    this.bandLoTex = this.uploadPack(this.bandLoTex, data.bandsLo, 4);
    this.bandHiTex = this.uploadPack(this.bandHiTex, data.bandsHi, 4);
    this.visibleSeconds = Math.min(
      Math.max(DEFAULT_VISIBLE_SECONDS, MIN_VISIBLE_SECONDS),
      data.duration,
    );
    this.beatgridCache = null; // beat x-positions depend on track duration
    this.markDirty();
  }

  public setStyle(styleId: string, params?: Partial<StyleParams>): void {
    this.styleId = styleId;
    if (params) this.params = { ...this.params, ...params };
    this.markDirty();
  }

  public setCuePoint(cueTime: number | null): void {
    this.cuePoint = cueTime;
    this.markDirty();
  }

  /** Shaded overlay regions (looping 05); empty clears. Positions are
   * track-time, so a region drawn per frame translates with the content. */
  public setRegions(regions: OverlayRegion[]): void {
    this.regions = regions;
    this.markDirty();
  }

  public setHotCues(
    hotCues: Array<{ slot_number: number; time_seconds: number; color?: string | null }>,
  ): void {
    this.hotCues.clear();
    for (const hc of hotCues) {
      this.hotCues.set(hc.slot_number, { time: hc.time_seconds, color: hc.color });
    }
    this.markDirty();
  }

  public setBeatgrid(
    beatTimes: number[],
    downbeatTimes: number[],
    /** Metric-ladder projection slice (metric-ladder 01); omitted → every
     * downbeat renders tier 0 (legacy two-tier look). */
    ladder?: LadderGridInput | null,
  ): void {
    this.beatTimes = new Float32Array(beatTimes);
    this.beatTimesPlain = beatTimes;
    this.downbeatTimes = new Float32Array(downbeatTimes);
    // New data must invalidate the vertex cache explicitly (a nudged grid
    // otherwise keeps drawing stale lines — off-by-a-nudge).
    this.beatgridCache = null;
    this.beatTiers = matchBeatTiers(beatTimes, downbeatTimes, ladder?.tiers ?? null);
    this.dropMarkWidthMul = null; // drop-line widths follow their beatlines
    this.tierBars = ladder?.tierBars ?? [1];
    this.ladder = ladder ?? null;
    this.markDirty();
  }

  /** Reset-mark indicator positions (already downbeat-resolved); empty
   * clears. Drawn per frame like cues, so they translate with content. */
  public setResetMarks(times: number[]): void {
    this.resetMarks = times;
    this.markDirty();
  }

  /** Possible-drop hypotheses (structure-analysis 02): analysis opinion,
   * drawn as dashed red lines on the 2D overlay (dashed = visibly not a
   * cue; the GL overlay pass only does solid rects). Empty clears. */
  public setDropMarks(marks: Array<{ time: number; strength: number }>): void {
    this.dropMarks = marks;
    this.dropMarkWidthMul = null;
    this.markDirty();
  }

  /** Beatjump target guides (beatjump-guides 01): the deck's jump size in
   * beats; null hides. Targets recompute per frame from the playhead via
   * the same beat-domain math the jump itself uses. */
  public setBeatjumpGuides(beats: number | null): void {
    this.beatjumpBeats = beats;
    this.markDirty();
  }

  /** Per-column automation modulation (editor rows); null clears. */
  public setModulation(fn: WaveformModulation | null): void {
    this.modulation = fn;
    this.markDirty();
  }

  /**
   * Externally control the visible window as normalized track positions
   * (may extend past [0,1]). Disables playhead-following; the clock is then
   * only read to draw the playhead marker inside the window.
   */
  public setDisplayWindow(first: number, last: number): void {
    this.externalWindow = true;
    this.windowStart = first;
    this.windowEnd = last;
    this.markDirty();
  }

  /** Splice the canvas into per-segment windows (transition-takes 06);
   * null restores the single-window path. An EMPTY array is meaningful:
   * spliced mode with nothing visible — the frame clears to background
   * instead of falling back to a stale single window. */
  public setDisplaySegments(segments: DisplaySegment[] | null): void {
    this.displaySegments = segments;
    this.markDirty();
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
      this.beatgridCache = null;
    }
    gl.viewport(0, 0, w, h);

    this.lastPlayhead = clock.getPlayhead();

    if (this.displaySegments) {
      this.renderSegmentedFrame(w, h, dpr);
      return;
    }

    const view = this.computeView(w, h, dpr);
    this.drawBody(view);
    this.drawOverlays(view);
  }

  /** DAW-splice frame (transition-takes 06): one body pass per segment
   * strip. Sub-pixel strips are skipped; canvas areas outside every strip
   * clear to the out-of-range dimmed background (BG × 0.6 — "no content
   * here", same as the shader's off-track look). */
  private renderSegmentedFrame(w: number, h: number, dpr: number): void {
    const { gl } = this;
    const duration = this.data!.duration;

    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.03 * 0.6, 0.03 * 0.6, 0.05 * 0.6, 1); // BG * 0.6 (shader constant)
    gl.clear(gl.COLOR_BUFFER_BIT);
    const ctx = this.ensureOverlayContext();
    ctx?.clearRect(0, 0, w, h);

    gl.enable(gl.SCISSOR_TEST);
    for (const seg of this.displaySegments!) {
      const x0 = Math.round(seg.x0Frac * w);
      const x1 = Math.round(seg.x1Frac * w);
      const segW = x1 - x0;
      if (segW < 1) continue; // sub-pixel segment: nothing to draw
      gl.scissor(x0, 0, segW, h);

      // BODY: viewport = the strip; u_canvasWidth = strip width, so
      // spp/LOD selection and the pixel-snapped origin are per-segment
      // exact (no peak shimmer at seams — ADR 0015 per strip).
      gl.viewport(x0, 0, segW, h);
      const bodyView: FrameView = {
        startTime: seg.first * duration,
        visibleSeconds: Math.max((seg.last - seg.first) * duration, 1e-6),
        playhead: this.lastPlayhead,
        w: segW,
        h,
        dpr,
      };
      this.drawBody(bodyView, seg.modAffine);

      // OVERLAYS: full viewport, time-shifted view — beat/cue x-positions
      // land inside the strip and the scissor clips the rest. pxPerSec
      // derives from the UNROUNDED strip width: all strips share one time
      // scale, so the value (hence the beatgrid vertex cache key) is
      // bit-identical across strips — rounded widths would rebuild the
      // vertex buffer per strip per frame. Rounded x0 against unrounded
      // pxPerSec costs the overlay lines ≤1px, invisible at line widths.
      gl.viewport(0, 0, w, h);
      const pxPerSec = ((seg.x1Frac - seg.x0Frac) * w) / bodyView.visibleSeconds;
      const overlayView: FrameView = {
        startTime: bodyView.startTime - x0 / pxPerSec,
        visibleSeconds: w / pxPerSec,
        playhead: this.lastPlayhead,
        w,
        h,
        dpr,
      };
      this.drawOverlays(overlayView, {
        skipPlayhead: !seg.drawPlayhead,
        textClip: { x0, w: segW },
      });
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, w, h);
  }

  /**
   * Self-driving loop (performance-hardening 01): renderFrame on an own
   * clock that idles when there's nothing to draw. A frame renders when the
   * playhead moved (playing/scrubbing), a mutator marked the renderer dirty
   * since the last frame, or the canvas resized; otherwise the loop drops
   * from rAF to a 250ms idle poll whose ticks only CHECK (no GL work at
   * all while paused and unchanged). It sleeps entirely while the owning
   * view is hidden (`setActive(false)`), and wakes instantly on the next
   * mutation or activation — the idiom shared by DawTimeline /
   * usePlayGuides. The `driven` path (caller's own motion clock) never
   * calls this.
   */
  public startRenderLoop(clock: PlaybackClock): void {
    this.clock = clock;
    this.clearScheduled();
    const schedule = (playedOrDirty: boolean) => {
      if (!this.active) return; // hidden view: sleep until setActive(true)
      if (playedOrDirty) this.animationFrame = requestAnimationFrame(tick);
      else this.idleTimer = window.setTimeout(tick, IDLE_TICK_MS);
    };
    const tick = () => {
      this.animationFrame = null;
      this.idleTimer = null;
      const moved = clock.getPlayhead() !== this.lastPlayhead;
      const wasDirty = this.dirty;
      const needsDraw = this.playing || moved || wasDirty || this.canvasResized();
      if (needsDraw) {
        this.dirty = false;
        this.renderFrame(clock);
      }
      // Playing, playhead motion this frame (scrubbing), OR any pending
      // mutation keeps the loop at 60fps; a still, unchanged, paused frame
      // drops to the idle poll.
      schedule(this.playing || moved || wasDirty || this.dirty);
    };
    this.scheduledTick = tick;
    // Prime lastPlayhead so the first idle decision compares against a real
    // read, then run the first frame.
    this.lastPlayhead = clock.getPlayhead();
    this.dirty = true;
    tick();
  }

  /** Gate the whole self-driven loop on the owning view's visibility
   * (performance-hardening 01): a hidden keep-alive view schedules zero rAF
   * work; re-activation repaints immediately (no stale first frame). */
  public setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      this.clearScheduled();
    } else if (this.clock) {
      // Wake: force a fresh frame, then resume scheduling.
      this.markDirty();
      this.startRenderLoop(this.clock);
    }
  }

  /** A layout resize the idle poll must catch (the drag-resize case where
   * no mutator fires): CSS size or dpr no longer matches the backing
   * store. renderFrame does the actual resize + repaint. */
  private canvasResized(): boolean {
    const dpr = window.devicePixelRatio || 1;
    return (
      this.canvas.width !== Math.round(this.canvas.clientWidth * dpr) ||
      this.canvas.height !== Math.round(this.canvas.clientHeight * dpr)
    );
  }

  /** Track whether the deck is advancing (performance-hardening 01): pins
   * the loop at 60fps while true, and a false→true flip wakes an idle loop
   * on the spot so playback starts smooth (no first-frame hitch). */
  public setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    if (playing) this.markDirty(); // wake an idle-polling loop now
  }

  private clearScheduled(): void {
    this.scheduledTick = null;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  public stopRenderLoop(): void {
    this.clearScheduled();
  }

  private computeView(w: number, h: number, dpr: number): FrameView {
    const duration = this.data!.duration;
    let startTime: number;
    let visibleSeconds: number;
    if (this.isMinimap) {
      startTime = 0;
      visibleSeconds = duration;
    } else if (this.externalWindow) {
      startTime = this.windowStart * duration;
      visibleSeconds = Math.max((this.windowEnd - this.windowStart) * duration, 1e-6);
    } else {
      visibleSeconds = this.visibleSeconds;
      const marker = this.config.playMarkerPosition ?? 0.25;
      startTime = this.lastPlayhead - marker * visibleSeconds;
    }
    return { startTime, visibleSeconds, playhead: this.lastPlayhead, w, h, dpr };
  }

  private drawBody(view: FrameView, modAffine?: { offset: number; scale: number }): void {
    const { gl, data } = this;
    const prog = this.programFor(this.styleId);
    gl.useProgram(prog);
    gl.disable(gl.BLEND);
    const u = (name: string) => gl.getUniformLocation(prog, name);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.peakTex!.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bandLoTex!.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bandHiTex!.tex);
    gl.uniform1i(u('u_peakTex'), 0);
    gl.uniform1i(u('u_bandLoTex'), 1);
    gl.uniform1i(u('u_bandHiTex'), 2);
    this.uploadLod(prog, 'u_peak', this.peakTex!.pack);
    this.uploadLod(prog, 'u_band', this.bandLoTex!.pack);

    // Modulation texture (sampled fresh each frame: window and automation
    // both move; 1024 callback samples is well within frame budget).
    gl.uniform1f(u('u_modEnabled'), this.modulation ? 1 : 0);
    if (this.modulation) {
      this.uploadModulation(view, modAffine);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.modTex);
      gl.uniform1i(u('u_modTex'), 3);
      gl.uniform1f(u('u_modStart'), view.startTime);
      gl.uniform1f(u('u_modSpan'), view.visibleSeconds);
    }

    // Pixel-snapped view origin (ADR 0015); overlays stay smooth.
    const spp = view.visibleSeconds / view.w;
    const snappedStart = Math.floor(view.startTime / spp) * spp;

    const hd = data!.header;
    gl.uniform1f(u('u_sampleRate'), hd.sampleRate);
    gl.uniform1f(u('u_peakHop'), hd.peakHop);
    gl.uniform1f(u('u_bandHop'), hd.bandHop);
    gl.uniform1f(u('u_stftWindow'), hd.stftWindow);
    gl.uniform1f(u('u_duration'), hd.duration);
    gl.uniform1f(u('u_invGamma'), 1 / hd.gamma);
    gl.uniform1f(u('u_startTime'), snappedStart);
    gl.uniform1f(u('u_visibleSeconds'), view.visibleSeconds);
    gl.uniform1f(u('u_canvasWidth'), view.w);
    gl.uniform1f(u('u_displayGamma'), this.params.displayGamma);
    // Per-surface scaling differences (e.g. minimap headroom) live in the
    // style slots (styleSlots.ts), not here.
    gl.uniform1f(u('u_master'), this.params.master);
    gl.uniform3f(u('u_groupGains'), ...this.params.gains);
    gl.uniform2i(u('u_groupBounds'), this.params.b1, this.params.b2);
    gl.uniform1f(u('u_smooth'), this.params.smooth ? 1 : 0);
    gl.uniform1f(u('u_coreWhite'), this.params.coreWhite);
    gl.uniform1f(u('u_coreBloom'), this.params.coreBloom);
    const colors = this.params.colors ?? getStyle(this.styleId).defaultColors;
    gl.uniform3f(u('u_colorLow'), ...colors[0]);
    gl.uniform3f(u('u_colorMid'), ...colors[1]);
    gl.uniform3f(u('u_colorHigh'), ...colors[2]);
    gl.uniform1i(u('u_anchor'), this.anchor === 'center' ? 0 : this.anchor === 'top' ? 1 : 2);
    gl.uniform1f(u('u_brightness'), this.brightness);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private uploadModulation(
    view: FrameView,
    modAffine?: { offset: number; scale: number }
  ): void {
    const { gl } = this;
    // Select unit 3 BEFORE any bind: binding on the implicitly-active unit
    // clobbers the band texture on unit 2 (the shader then renders the
    // automation lanes as high-band energy — tinted blocks on the rows).
    gl.activeTexture(gl.TEXTURE3);
    if (!this.modTex) {
      this.modTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.modTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MOD_TEX_WIDTH, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const fn = this.modulation!;
    const s = this.modScratch;
    for (let i = 0; i < MOD_TEX_WIDTH; i++) {
      const raw = view.startTime + ((i + 0.5) / MOD_TEX_WIDTH) * view.visibleSeconds;
      // Segmented mode remaps track → mix time (track time is ambiguous
      // across replayed segments; the envelope lives on the mix axis).
      const t = modAffine ? modAffine.offset + raw * modAffine.scale : raw;
      const m = fn(t);
      s[i * 4] = Math.max(0, Math.min(255, (m.low / MOD_RANGE) * 255));
      s[i * 4 + 1] = Math.max(0, Math.min(255, (m.mid / MOD_RANGE) * 255));
      s[i * 4 + 2] = Math.max(0, Math.min(255, (m.high / MOD_RANGE) * 255));
      s[i * 4 + 3] = Math.max(0, Math.min(255, (m.gain / MOD_RANGE) * 255));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.modTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MOD_TEX_WIDTH, 1, gl.RGBA, gl.UNSIGNED_BYTE, s);
  }

  // -------------------------------------------------------------- overlays

  private initOverlayPass(): void {
    const { gl } = this;
    this.overlayProgram = this.buildProgram(OVERLAY_VS, OVERLAY_FS);
    const makeVao = (buffer: WebGLBuffer) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const aPos = gl.getAttribLocation(this.overlayProgram!, 'a_position');
      const aCol = gl.getAttribLocation(this.overlayProgram!, 'a_color');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 20, 8);
      gl.bindVertexArray(null);
      return vao;
    };
    this.overlayBuffer = gl.createBuffer()!;
    this.overlayVao = makeVao(this.overlayBuffer);
    this.beatgridBuffer = gl.createBuffer()!;
    this.beatgridVao = makeVao(this.beatgridBuffer);
  }

  private drawOverlays(
    view: FrameView,
    opts: { skipPlayhead?: boolean; textClip?: { x0: number; w: number } } = {}
  ): void {
    const { gl } = this;
    const prog = this.overlayProgram!;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(prog, 'u_matrix'),
      false,
      orthoMatrix(0, view.w, view.h, 0),
    );
    const uOffset = gl.getUniformLocation(prog, 'u_offsetPx');
    const uAlpha = gl.getUniformLocation(prog, 'u_alpha');
    gl.uniform1f(uAlpha, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive (legacy parity: rgb premultiplied)

    // Played-portion dim (minimap, zoned-marks verdict): 0.35 black wash
    // over the body left of the playhead. Draw order body → dim → marks,
    // so every mark keeps full brightness in the played region. With the
    // playhead inside an overlay region (active loop), the wash stops at
    // the region's left edge — about to replay, never "already heard".
    if (this.isMinimap && !opts.skipPlayhead) {
      const dimTime = playedDimBoundary(view.playhead, this.regions);
      const dimX = Math.max(
        0,
        Math.min(view.w, (dimTime / this.data!.duration) * view.w),
      );
      if (dimX > 0) {
        const dimVerts: number[] = [];
        pushRect(dimVerts, 0, 0, dimX, view.h, 0, 0, 0);
        // Blend rgb only — writing src alpha into the canvas would make it
        // semi-transparent and let the page background composite through
        // (a gray wash instead of a darkening).
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.uniform1f(uAlpha, 0.35);
        this.drawTriangles(dimVerts, this.overlayVao!, this.overlayBuffer!);
        gl.uniform1f(uAlpha, 1);
        gl.blendFunc(gl.ONE, gl.ONE);
      }
    }

    this.drawBeatgrid(view, uOffset);
    gl.uniform1f(uOffset, 0);

    const scratch: number[] = [];
    this.pushRegions(view, scratch); // under the markers
    if (this.cuePoint !== null) this.pushCuePoint(view, scratch);
    this.pushBeatjumpGuides(view, scratch);
    this.drawTriangles(scratch, this.overlayVao!, this.overlayBuffer!);

    // Hot cues draw with standard alpha blending (accurate colors).
    // Reset marks push first so cue marks win where they collide.
    const hotCueVerts: number[] = [];
    this.pushResetMarks(view, hotCueVerts);
    this.pushHotCues(view, hotCueVerts);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    if (this.isMinimap) gl.uniform1f(uAlpha, 0.95);
    this.drawTriangles(hotCueVerts, this.overlayVao!, this.overlayBuffer!);
    gl.uniform1f(uAlpha, 1);
    gl.blendFunc(gl.ONE, gl.ONE);

    if (!opts.skipPlayhead) {
      const playheadVerts: number[] = [];
      this.pushPlayhead(view, playheadVerts);
      this.drawTriangles(playheadVerts, this.overlayVao!, this.overlayBuffer!);
    }

    // 2D text overlay: hot-cue badges + time/bar readout (main only).
    // GL scissor doesn't clip 2D canvases — segmented mode passes an
    // explicit clip (and clears once per frame, not per segment).
    const ctx = this.ensureOverlayContext();
    if (ctx) {
      if (opts.textClip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(opts.textClip.x0, 0, opts.textClip.w, view.h);
        ctx.clip();
      } else {
        ctx.clearRect(0, 0, view.w, view.h);
      }
      this.renderDropMarks(ctx, view); // under the badges: opinion < curation
      this.renderHotCueNumbers(ctx, view);
      if ((this.config.showTimeReadout ?? false) && !this.isMinimap) {
        this.renderTimeReadout(ctx, view);
      }
      if (opts.textClip) ctx.restore();
    }
  }

  private drawTriangles(verts: number[], vao: WebGLVertexArrayObject, buffer: WebGLBuffer): void {
    if (verts.length === 0) return;
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 5);
    gl.bindVertexArray(null);
  }

  /** Beat lines are built in time-anchored pixel space (x = t * pxPerSec) so
   * scrolling is a uniform translation; rebuilt only on zoom/resize/data. */
  private drawBeatgrid(view: FrameView, uOffset: WebGLUniformLocation | null): void {
    const { gl } = this;
    if (!this.beatTimes || !this.data || this.beatTimes.length === 0) return;

    const pxPerSec = view.w / view.visibleSeconds;
    const key = `${view.w}x${view.h}:${pxPerSec}`;
    if (!this.beatgridCache || this.beatgridCache.key !== key) {
      const verts = this.buildBeatgridVertices(view, pxPerSec);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.beatgridBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      this.beatgridCache = { key, vertexCount: verts.length / 5 };
    }
    if (this.beatgridCache.vertexCount === 0) return;
    gl.uniform1f(uOffset, -view.startTime * pxPerSec);
    gl.bindVertexArray(this.beatgridVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.beatgridCache.vertexCount);
    gl.bindVertexArray(null);
  }

  private buildBeatgridVertices(view: FrameView, pxPerSec: number): Float32Array {
    const beatTimes = this.beatTimes!;
    const beatTiers = this.beatTiers;
    const downbeatTimes = this.downbeatTimes;
    const tierBars = this.tierBars;
    const lineWidth = 1 * view.dpr;

    // Density culling: weak beats hide below ~12px/beat (legacy parity);
    // each Metric-ladder tier hides below its own minimum spacing, so
    // zoomed out only phrase-level lines survive (metric-ladder 01). Bar
    // width comes from the downbeat lattice itself (any time signature)
    // and tier spans from the projection — no duple assumption here.
    const secPerBeat = beatTimes.length > 1 ? beatTimes[1] - beatTimes[0] : this.data!.duration;
    const pxPerBeat = secPerBeat * pxPerSec;
    const showWeakBeats = pxPerBeat >= 12 * view.dpr;
    const secPerBar =
      downbeatTimes && downbeatTimes.length > 1
        ? downbeatTimes[1] - downbeatTimes[0]
        : secPerBeat * 4;
    const pxPerBar = secPerBar * pxPerSec;
    let minTier = tierBars.length;
    for (let k = 0; k < tierBars.length; k++) {
      if (pxPerBar * tierBars[k] >= TIER_MIN_SPACING_PX * view.dpr) {
        minTier = k;
        break;
      }
    }
    if (minTier >= tierBars.length) return new Float32Array(0);

    const verts: number[] = [];
    this.pushParentheticalBands(view, pxPerSec, verts);
    const maxStyle = TIER_WIDTH.length - 1;
    for (let i = 0; i < beatTimes.length; i++) {
      const tier = beatTiers ? beatTiers[i] : -1;
      if (tier < 0 && !showWeakBeats) continue;
      if (tier >= 0 && tier < minTier) continue;
      const x = beatTimes[i] * pxPerSec;
      const s = tier < 0 ? -1 : Math.min(tier, maxStyle);
      const width = s < 0 ? lineWidth : TIER_WIDTH[s] * view.dpr;
      const alpha = s < 0 ? 0.15 : TIER_ALPHA[s];
      pushRect(verts, x, 0, width, view.h, alpha, alpha, alpha);
    }
    return new Float32Array(verts);
  }

  /** Parenthetical ("extra") bars render visibly OTHER (metric-ladder 03):
   * a gold edge band plus a faint full-height wash across each contiguous
   * run, so a fakeout extension is unmissable before you're inside it.
   * Time-anchored like the gridlines (cached per zoom). Gold is the
   * Metric-ladder authoring color (Reset-mark pennants). */
  private pushParentheticalBands(view: FrameView, pxPerSec: number, verts: number[]): void {
    const ladder = this.ladder;
    const downbeats = this.downbeatTimes;
    if (!ladder || !downbeats || downbeats.length === 0) return;
    const [r, g, b] = RESET_MARK_COLOR;
    const bandH = 4 * view.dpr;
    const bandY = this.anchor === 'bottom' ? view.h - bandH : 0;
    const bandA = 0.5;
    const washA = 0.05;
    for (let i = 0; i < downbeats.length; i++) {
      if (!ladder.parentheticals[i]) continue;
      let end = i;
      while (end + 1 < downbeats.length && ladder.parentheticals[end + 1]) end++;
      // A parenthetical run is always bounded by a following reset's
      // downbeat (the final open segment never flags), so end+1 exists.
      const x0 = downbeats[i] * pxPerSec;
      const x1 = downbeats[Math.min(end + 1, downbeats.length - 1)] * pxPerSec;
      pushRect(verts, x0, 0, x1 - x0, view.h, r * washA, g * washA, b * washA);
      pushRect(verts, x0, bandY, x1 - x0, bandH, r * bandA, g * bandA, b * bandA);
      i = end;
    }
  }

  private timeToX(t: number, view: FrameView): number {
    return ((t - view.startTime) / view.visibleSeconds) * view.w;
  }

  /** Shaded regions (looping 05): translucent full-height fill spanning
   * the region, plus solid edge lines on full waveforms or a 2px guide
   * line at the strip's TOP edge on the minimap (minimap-clarity verdict —
   * the bottom edge is the body's zero line, kept clean). Additive blend:
   * colors arrive premultiplied by their alpha. */
  private pushRegions(view: FrameView, verts: number[]): void {
    for (const region of this.regions) {
      const x0 = this.timeToX(region.start, view);
      const x1 = this.timeToX(region.end, view);
      if (x1 <= x0 || x1 <= 0 || x0 >= view.w) continue;
      const [r, g, b] = region.color;
      const cx0 = Math.max(x0, 0);
      const cx1 = Math.min(x1, view.w);
      const a = region.fillAlpha;
      pushRect(verts, cx0, 0, cx1 - cx0, view.h, r * a, g * a, b * a);
      const edgeAlpha = 0.85;
      const edgeWidth = 2 * view.dpr;
      if (this.isMinimap) {
        pushRect(
          verts, cx0, 0, cx1 - cx0, edgeWidth,
          r * edgeAlpha, g * edgeAlpha, b * edgeAlpha,
        );
        continue;
      }
      if (region.edges) {
        for (const x of [x0, x1 - edgeWidth]) {
          if (x + edgeWidth <= 0 || x >= view.w) continue;
          pushRect(verts, x, 0, edgeWidth, view.h, r * edgeAlpha, g * edgeAlpha, b * edgeAlpha);
        }
      }
    }
  }

  private pushCuePoint(view: FrameView, verts: number[]): void {
    const cueX = this.timeToX(this.cuePoint!, view);
    if (cueX < 0 || cueX >= view.w) return;
    // The CUE button's accent (--energy-3 #ff9933) — marker and button
    // read as one control.
    const [r, g, b] = [1.0, 0.6, 0.2];
    pushRect(verts, cueX, 0, 2, view.h, r, g, b);
    const cx = cueX + 1;
    if (this.isMinimap) {
      // Zoned marks: the main cue's identity glyph is a BOTTOM triangle
      // (the top zone belongs to hotcue flags, mid to guide arrows).
      const halfW = 5 * view.dpr;
      const depth = 8 * view.dpr;
      verts.push(
        cx - halfW, view.h, r, g, b,
        cx + halfW, view.h, r, g, b,
        cx, view.h - depth, r, g, b,
      );
    } else {
      // Bottom identity triangle, sized to read at a glance (12% of the
      // wave height, never smaller than the minimap glyph).
      const triH = Math.max(view.h * 0.12, 8 * view.dpr);
      verts.push(
        cx - triH / 2, view.h, r, g, b,
        cx + triH / 2, view.h, r, g, b,
        cx, view.h - triH, r, g, b,
      );
    }
  }

  /** Beatjump target guides (beatjump-guides 01): where jump back/forward
   * would land from the CURRENT playhead — a faint playhead-pink line plus
   * a top chevron pointing along the jump. Recomputed per frame with the
   * exact math the jump uses (addBeats, clamped like clampPlayhead), so
   * the guide never lies. Grid-only (the gridless bpm fallback has no
   * lattice worth aiming at) and hidden on minimaps. */
  private pushBeatjumpGuides(view: FrameView, verts: number[]): void {
    const beats = this.beatjumpBeats;
    const beatTimes = this.beatTimesPlain;
    if (beats === null || this.isMinimap || !this.data) return;
    if (!beatTimes || beatTimes.length < 2) return;
    const [pr, pg, pb] = PLAYHEAD_COLOR;
    for (const dir of [-1, 1]) {
      const raw = addBeats(view.playhead, dir * beats, beatTimes);
      // The ENGINE's clamp, not 0: a backward jump may land in the silent
      // lead-in, and the guide must land where the jump does.
      const t = Math.max(-MAX_LEAD_IN_SECONDS, Math.min(this.data.duration, raw));
      const x = this.timeToX(t, view);
      if (x < 0 || x >= view.w) continue;
      // Additive batch: colors premultiplied. Playhead pink, faint line.
      const lineA = 0.28;
      const w = 1 * view.dpr;
      pushRect(verts, x - w / 2, 0, w, view.h, pr * lineA, pg * lineA, pb * lineA);
      const c = 5 * view.dpr;
      const chevA = 0.85;
      verts.push(
        x, 0, pr * chevA, pg * chevA, pb * chevA,
        x, 1.6 * c, pr * chevA, pg * chevA, pb * chevA,
        x + dir * c, 0.8 * c, pr * chevA, pg * chevA, pb * chevA,
      );
    }
  }

  /** Gold pole + LEFT-flying pennant (cue flags fly right) at each Reset
   * mark. The earliest mark is the derived anchor and gets a solid pennant;
   * later resets are outlined (ADR 0030). */
  private pushResetMarks(view: FrameView, verts: number[]): void {
    if (this.resetMarks.length === 0) return;
    const [r, g, b] = RESET_MARK_COLOR;
    for (let markIndex = 0; markIndex < this.resetMarks.length; markIndex++) {
      const t = this.resetMarks[markIndex];
      const x = this.timeToX(t, view);
      if (x < 0 || x >= view.w) continue;
      const poleW = 2 * view.dpr;
      const flag = 6 * view.dpr;
      pushRect(verts, x - poleW / 2, 0, poleW, view.h, r, g, b);
      // Pennant at the mark's identity zone: top edge (bottom on
      // bottom-anchored editor rows), pointing left.
      const y0 = this.anchor === 'bottom' ? view.h - flag : 0;
      const poleX = x - poleW / 2;
      if (markIndex === 0) {
        verts.push(
          poleX, y0, r, g, b,
          poleX, y0 + flag, r, g, b,
          poleX - flag, y0 + flag / 2, r, g, b,
        );
      } else {
        const outlineW = 1.25 * view.dpr;
        pushLineSegment(verts, poleX, y0, poleX, y0 + flag, outlineW, r, g, b);
        pushLineSegment(
          verts,
          poleX,
          y0,
          poleX - flag,
          y0 + flag / 2,
          outlineW,
          r,
          g,
          b,
        );
        pushLineSegment(
          verts,
          poleX - flag,
          y0 + flag / 2,
          poleX,
          y0 + flag,
          outlineW,
          r,
          g,
          b,
        );
      }
    }
  }

  private pushHotCues(view: FrameView, verts: number[]): void {
    for (const [slot, hc] of this.hotCues.entries()) {
      const x = this.timeToX(hc.time, view);
      if (x < 0 || x >= view.w) continue;
      // Stored per-cue color first (pad/ladder precedence — hotcue-colors
      // 01); saturated slot palette for colorless cues.
      const [r, g, b] = parseCueColor(hc.color) ?? HOT_CUE_COLORS[slot] ?? [1, 1, 1];
      if (this.isMinimap) {
        // Zoned marks: 2px full-height pole flying a 5×5 square flag off
        // its top RIGHT — the hotcues' identity zone is the top edge.
        pushRect(verts, x - 1 * view.dpr, 0, 2 * view.dpr, view.h, r, g, b);
        pushRect(verts, x + 1 * view.dpr, 0, 5 * view.dpr, 5 * view.dpr, r, g, b);
        continue;
      }
      // Zoomed surfaces (main waveform + editor timeline rows): 2px pole
      // only — the numbered FLAG (2D overlay, renderHotCueNumbers) flies
      // off the pole at the identity-zone edge, scaling the minimap's
      // pole+flag idiom up.
      const poleW = 2 * view.dpr;
      pushRect(verts, x - poleW / 2, 0, poleW, view.h, r, g, b);
    }
  }

  private pushPlayhead(view: FrameView, verts: number[]): void {
    let x: number;
    if (this.isMinimap) {
      x = (view.playhead / this.data!.duration) * view.w;
    } else if (this.externalWindow) {
      x = this.timeToX(view.playhead, view);
      if (x < 0 || x >= view.w) return;
    } else {
      x = view.w * (this.config.playMarkerPosition ?? 0.25);
    }
    pushRect(verts, x, 0, 3, view.h, ...PLAYHEAD_COLOR);
  }

  private ensureOverlayContext(): CanvasRenderingContext2D | null {
    if (this.isMinimap || !this.data) return null;
    this.gl.flush();
    let overlayCanvas = this.overlayCanvas;
    if (!overlayCanvas || !overlayCanvas.isConnected) {
      const parent = this.canvas.parentElement;
      overlayCanvas =
        parent?.querySelector<HTMLCanvasElement>(':scope > canvas.waveform-text-overlay') ?? null;
      if (!overlayCanvas) {
        overlayCanvas = document.createElement('canvas');
        overlayCanvas.className = 'waveform-text-overlay';
        overlayCanvas.style.position = 'absolute';
        overlayCanvas.style.top = '0';
        overlayCanvas.style.left = '0';
        overlayCanvas.style.pointerEvents = 'none';
        overlayCanvas.style.zIndex = '1';
        parent?.appendChild(overlayCanvas);
      }
      this.overlayCanvas = overlayCanvas;
      this.overlayCtx = overlayCanvas.getContext('2d');
    }
    if (overlayCanvas.width !== this.canvas.width || overlayCanvas.height !== this.canvas.height) {
      overlayCanvas.width = this.canvas.width;
      overlayCanvas.height = this.canvas.height;
      overlayCanvas.style.width = `${this.canvas.clientWidth}px`;
      overlayCanvas.style.height = `${this.canvas.clientHeight}px`;
    }
    return this.overlayCtx;
  }

  /** Width multiplier per drop mark = the width of the beatline it sits on
   * (marks land on downbeats): nearest beat's tier -> TIER_WIDTH, weak/no
   * grid -> the 1px beat width. Cached; invalidated by setDropMarks and
   * setBeatgrid. */
  private dropWidthMultipliers(): number[] {
    if (this.dropMarkWidthMul) return this.dropMarkWidthMul;
    const beats = this.beatTimesPlain;
    const tiers = this.beatTiers;
    const maxStyle = TIER_WIDTH.length - 1;
    this.dropMarkWidthMul = this.dropMarks.map((mark) => {
      if (!beats || beats.length === 0 || !tiers) return 1;
      let lo = 0;
      let hi = beats.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] < mark.time) lo = mid + 1;
        else hi = mid;
      }
      const i =
        lo > 0 && Math.abs(beats[lo - 1] - mark.time) < Math.abs(beats[lo] - mark.time)
          ? lo - 1
          : lo;
      const tier = tiers[i];
      return tier < 0 ? 1 : TIER_WIDTH[Math.min(tier, maxStyle)];
    });
    return this.dropMarkWidthMul;
  }

  /** Dashed red verticals at possible drops (structure-analysis 02).
   * Dashed + red = analysis opinion, visually distinct from every curated
   * marker (solid cue poles, gold reset pennants). Opacity tracks detector
   * strength so the likely first drop reads loudest. Each line takes the
   * exact width and left-aligned geometry of the beatline under it, so the
   * dashes read as "this gridline, flagged". */
  private renderDropMarks(ctx: CanvasRenderingContext2D, view: FrameView): void {
    if (this.dropMarks.length === 0) return;
    const widths = this.dropWidthMultipliers();
    ctx.save();
    ctx.setLineDash([7 * view.dpr, 5 * view.dpr]);
    for (let i = 0; i < this.dropMarks.length; i++) {
      const mark = this.dropMarks[i];
      const w = widths[i] * view.dpr;
      // Beatlines are left-aligned rects at x (buildBeatgridVertices);
      // stroke centered at x + w/2 covers the same pixels.
      const x = this.timeToX(mark.time, view);
      if (x + w < 0 || x >= view.w) continue;
      ctx.lineWidth = w;
      ctx.strokeStyle = `rgba(255, 32, 48, ${0.35 + 0.55 * mark.strength})`;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, 0);
      ctx.lineTo(x + w / 2, view.h);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Numbered square FLAG attached to the pole's top right (bottom right
   * on bottom-anchored editor rows) — the minimap's pole+flag design
   * scaled up, solid cue color with the slot number knocked out dark. */
  private renderHotCueNumbers(ctx: CanvasRenderingContext2D, view: FrameView): void {
    if (this.hotCues.size === 0) return;
    const squareSize = 16 * view.dpr;
    const squareY = this.anchor === 'bottom' ? view.h - squareSize : 0;
    ctx.font = `bold ${12 * view.dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [slot, hc] of this.hotCues.entries()) {
      const x = this.timeToX(hc.time, view);
      if (x < 0 || x >= view.w) continue;
      // Attached to the 2px pole's right edge (pole is centered on x).
      const squareX = x + view.dpr;
      // Stored per-cue color first, like the marks (hotcue-colors 01).
      const color =
        hc.color && CUE_COLOR_RE.test(hc.color)
          ? hc.color
          : (HOT_CUE_CSS_COLORS[slot] ?? '#ffffff');
      ctx.fillStyle = color;
      ctx.fillRect(squareX, squareY, squareSize, squareSize);
      ctx.fillStyle = 'rgb(17, 17, 17)';
      ctx.fillText(String(slot), squareX + squareSize / 2, squareY + squareSize / 2);
    }
  }

  private renderTimeReadout(ctx: CanvasRenderingContext2D, view: FrameView): void {
    const duration = this.data!.duration;
    const bar = this.barNumberAt(view.playhead);
    // Position-in-top-tier from the governing reset (metric-ladder 03):
    // "bar 42 (13 of 16)" — parenthetical bars read "(+1)", "(+2)"…
    const count =
      bar !== null && this.ladder ? ` (${barCountLabel(this.ladder, bar - 1)})` : '';
    const text =
      `${formatReadoutTime(view.playhead)} / ${formatReadoutTime(duration)}` +
      (bar !== null ? `  bar ${bar}${count}` : '');
    const pad = 6 * view.dpr;
    ctx.font = `bold ${12 * view.dpr}px monospace`;
    const metrics = ctx.measureText(text);
    const textHeight = 14 * view.dpr;
    if (this.config.timeReadoutAnchor === 'top-left') {
      const off = this.config.timeReadoutOffset ?? { x: 8, y: 8 };
      const x = off.x * view.dpr;
      const y = off.y * view.dpr;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(17, 17, 17, 0.7)';
      ctx.fillRect(x - pad, y - pad / 2, metrics.width + pad * 2, textHeight + pad);
      ctx.fillStyle = 'rgb(205, 214, 244)'; // var(--text)
      ctx.fillText(text, x, y);
      return;
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(17, 17, 17, 0.7)';
    ctx.fillRect(
      view.w - pad * 2 - metrics.width,
      view.h - pad * 1.5 - textHeight,
      metrics.width + pad * 2,
      textHeight + pad,
    );
    ctx.fillStyle = 'rgb(205, 214, 244)'; // var(--text)
    ctx.fillText(text, view.w - pad, view.h - pad);
  }

  /** 1-based bar number at `time`, or null before the first downbeat. */
  private barNumberAt(time: number): number | null {
    const downbeats = this.downbeatTimes;
    if (!downbeats || downbeats.length === 0 || time < downbeats[0]) return null;
    let lo = 0;
    let hi = downbeats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (downbeats[mid] <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // ----------------------------------------------------------- interaction

  public setVisibleSeconds(seconds: number): void {
    if (!this.data) return;
    this.visibleSeconds = Math.min(
      Math.max(seconds, MIN_VISIBLE_SECONDS),
      this.data.duration,
    );
    this.markDirty();
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

  /** The current visible window, in track seconds (drag-to-scrub converts
   * pixels to time with it when the caller doesn't own the zoom). */
  public getVisibleSeconds(): number {
    return this.visibleSeconds;
  }

  /** Click-to-seek: the track time under the pointer (all modes). */
  public handleClick(event: MouseEvent): number | undefined {
    if (!this.data) return undefined;
    const rect = this.canvas.getBoundingClientRect();
    const frac = (event.clientX - rect.left) / rect.width;
    const dpr = window.devicePixelRatio || 1;
    const view = this.computeView(
      Math.round(this.canvas.clientWidth * dpr) || 1,
      Math.round(this.canvas.clientHeight * dpr) || 1,
      dpr,
    );
    const t = view.startTime + frac * view.visibleSeconds;
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
    if (this.modTex) gl.deleteTexture(this.modTex);
    if (this.overlayProgram) gl.deleteProgram(this.overlayProgram);
    if (this.overlayBuffer) gl.deleteBuffer(this.overlayBuffer);
    if (this.overlayVao) gl.deleteVertexArray(this.overlayVao);
    if (this.beatgridBuffer) gl.deleteBuffer(this.beatgridBuffer);
    if (this.beatgridVao) gl.deleteVertexArray(this.beatgridVao);
    // Remove OUR overlay canvas only.
    this.overlayCanvas?.remove();
    this.overlayCanvas = null;
    this.overlayCtx = null;
  }

  // -------------------------------------------------------------- internals

  private programFor(styleId: string): WebGLProgram {
    let prog = this.programs.get(styleId);
    if (!prog) {
      prog = this.buildProgram(BODY_VERTEX_SHADER, BODY_PRELUDE + getStyle(styleId).source + BODY_MAIN);
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

  private buildProgram(vsSource: string, fsSource: string): WebGLProgram {
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
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`waveform program link: ${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
  }
}

/** Two triangles forming an axis-aligned rectangle, colored (r,g,b). */
function pushRect(
  verts: number[],
  x: number, y: number, w: number, h: number,
  r: number, g: number, b: number,
): void {
  verts.push(
    x, y, r, g, b,
    x + w, y, r, g, b,
    x, y + h, r, g, b,
    x + w, y, r, g, b,
    x + w, y + h, r, g, b,
    x, y + h, r, g, b,
  );
}

/** Two triangles forming a constant-width line segment. */
function pushLineSegment(
  verts: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  r: number,
  g: number,
  b: number,
): void {
  const length = Math.hypot(x1 - x0, y1 - y0);
  if (length === 0) return;
  const px = (-(y1 - y0) / length) * (width / 2);
  const py = ((x1 - x0) / length) * (width / 2);
  verts.push(
    x0 + px, y0 + py, r, g, b,
    x1 + px, y1 + py, r, g, b,
    x0 - px, y0 - py, r, g, b,
    x1 + px, y1 + py, r, g, b,
    x1 - px, y1 - py, r, g, b,
    x0 - px, y0 - py, r, g, b,
  );
}

/** Orthographic projection: pixel space (top-left origin) to clip space. */
function orthoMatrix(left: number, right: number, bottom: number, top: number): Float32Array {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  return new Float32Array([
    -2 * lr, 0, 0, 0,
    0, -2 * bt, 0, 0,
    0, 0, -1, 0,
    (left + right) * lr, (top + bottom) * bt, 0, 1,
  ]);
}
