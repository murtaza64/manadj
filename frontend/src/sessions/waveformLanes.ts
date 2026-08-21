/**
 * Waveform lane drawing for the Session timeline (sessions 04 iteration) —
 * pure 2D canvas helpers. Full-color styled waveforms: the SAME persisted
 * Waveform style the editor/deck surfaces render (interpreted on the CPU
 * via sets/ladderWaveStyle — the Set-ladder precedent), mirrored around
 * the lane center like the editor's lanes, drawn over an audibility
 * area-chart fill and under beat gridlines.
 *
 * Session time is nonlinear in track time (jumps, pitch, idle collapse):
 * the playhead traces are cut into constant-rate RUNS, and each run maps
 * a linear track range onto a linear x range — computeStyledColumns per
 * run, beat/downbeat lines placed analytically inside it.
 */
import type { DecodedWaveform } from '../waveform/blob';
import type { StyleParams } from '../waveform/styles';
import type { ColumnModulation } from '../sets/ladderWaveStyle';
import { createStyledColumnRenderer } from '../sets/ladderWaveStyle';
import { hexToRgbTriplet } from '../theme/deckColors';
import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import type { DeckControlSteps, DeckTimeline, GainStep, TimeAxis } from './timelineModel';
import { DECK_CONTROL_DEFAULTS, gainAt } from './timelineModel';

/** Amortized px→t lookup for MONOTONICALLY increasing x (sessions 22):
 * `TimeAxis.pxToT` is a linear scan over segments, and the render pass
 * calls it per column/pixel — at low zoom that scan dominated the redraw.
 * The cursor advances a segment index instead (O(1) amortized); the
 * defensive rewind keeps it correct if a caller ever steps backward.
 * Same semantics as `pxToT`: collapsed markers map to their start,
 * out-of-range clamps to the ends. */
export function createMonotonicPxToT(axis: TimeAxis): (x: number) => number {
  const segs = axis.segments;
  let i = 0;
  return (x: number): number => {
    if (segs.length === 0) return 0;
    while (i > 0 && x < segs[i].px0) i--;
    while (i < segs.length - 1 && x > segs[i].px1) i++;
    const seg = segs[i];
    if (x <= seg.px0 && i === 0) return seg.start;
    if (x > seg.px1) return seg.end; // past the last segment
    if (seg.collapsed) return seg.start;
    const w = seg.px1 - seg.px0;
    return w <= 0 ? seg.start : seg.start + ((x - seg.px0) / w) * (seg.end - seg.start);
  };
}

export interface LaneGeometry {
  /** Full timeline width in CSS px (the x-coordinate space). */
  width: number;
  /** Lane's y offset and height in CSS px. */
  yOffset: number;
  height: number;
  /** Visible window in timeline px — draw ONLY [x0, x1]. The canvas is
   * viewport-sized and translated (a 2h session at 60px/s is ~430k px:
   * a full-width canvas is a browser-killing backing store). The ctx is
   * pre-translated by -x0, so helpers draw in timeline coordinates. */
  x0: number;
  x1: number;
}

/** Amortized t→px twin of `createMonotonicPxToT` for time-increasing
 * callers (trace polylines). Same semantics as `TimeAxis.tToPx`. */
export function createMonotonicTToPx(axis: TimeAxis): (t: number) => number {
  const segs = axis.segments;
  let i = 0;
  return (t: number): number => {
    if (segs.length === 0) return 0;
    while (i > 0 && t < segs[i].start) i--;
    while (i < segs.length - 1 && t > segs[i].end) i++;
    const seg = segs[i];
    if (t <= segs[0].start && i === 0) return 0;
    if (t > seg.end) return axis.totalPx; // past the last segment
    if (seg.collapsed) return (seg.px0 + seg.px1) / 2;
    const dur = seg.end - seg.start;
    return dur <= 0 ? seg.px0 : seg.px0 + ((t - seg.start) / dur) * (seg.px1 - seg.px0);
  };
}

/** Round to 0.1px: full-precision floats made the polyline attribute
 * strings several times longer than the drawing needs. */
const round10 = (v: number) => Math.round(v * 10) / 10;

/** A windowed trace as an SVG polyline `points` string, decimated to
 * ~pixel resolution (sessions 22): at low zoom a window slice is the
 * WHOLE trace — tens of thousands of points stringified per scene render.
 * Endpoints always survive; an interior point survives if it moves ≥1px
 * from the last kept point on EITHER axis (a sub-px-in-x seek spike still
 * registers via y). */
export function tracePolylinePoints(
  win: { t: number; playhead: number }[],
  xOf: (t: number) => number,
  yOf: (playhead: number) => number,
  minStepPx = 1
): string {
  if (win.length === 0) return '';
  const parts: string[] = [];
  let lastX = NaN;
  let lastY = NaN;
  for (let i = 0; i < win.length; i++) {
    const x = xOf(win[i].t);
    const y = yOf(win[i].playhead);
    if (
      i === 0 ||
      i === win.length - 1 ||
      Math.abs(x - lastX) >= minStepPx ||
      Math.abs(y - lastY) >= minStepPx
    ) {
      parts.push(`${round10(x)},${round10(y)}`);
      lastX = x;
      lastY = y;
    }
  }
  return parts.join(' ');
}

/** A constant-rate stretch of one playhead trace: session [t0,t1] maps
 * linearly onto track [ph0,ph1]. */
export interface TraceRun {
  t0: number;
  t1: number;
  ph0: number;
  ph1: number;
}

/** Thin a trace to samples ≥ `minDtS` apart (endpoints always kept).
 * Runs are RENDER units: at low zoom, jog/pitch wiggles between samples
 * closer than a pixel cut the trace into thousands of sub-pixel runs,
 * and the per-run fixed cost dominated every repaint (this issue). Any
 * position error this introduces is bounded by the decimation step —
 * sub-pixel at the zoom that chose it. */
function decimateTrace(
  trace: { t: number; playhead: number }[],
  minDtS: number
): { t: number; playhead: number }[] {
  if (minDtS <= 0 || trace.length < 3) return trace;
  const out = [trace[0]];
  const last = trace.length - 1;
  for (let i = 1; i < last; i++) {
    if (trace[i].t - out[out.length - 1].t >= minDtS) out.push(trace[i]);
  }
  out.push(trace[last]);
  return out;
}

/** Cut traces into constant-rate runs (rate changes at pitch moves; the
 * ~1 Hz samples make same-rate stretches long). Tolerance is generous —
 * a run is a RENDER unit, not evidence. `minDtS` pre-decimates each
 * trace to that sample spacing (zoom-adaptive callers pass ~¾px of
 * session time) so sub-pixel rate wiggles can't multiply run count. */
export function traceRuns(deck: DeckTimeline, rateTolerance = 0.04, minDtS = 0): TraceRun[] {
  const runs: TraceRun[] = [];
  for (const rawTrace of deck.traces) {
    const trace = decimateTrace(rawTrace, minDtS);
    if (trace.length < 2) continue;
    let start = 0;
    let rate: number | null = null;
    for (let i = 1; i < trace.length; i++) {
      const dt = trace[i].t - trace[i - 1].t;
      const r = dt > 0 ? (trace[i].playhead - trace[i - 1].playhead) / dt : 0;
      if (rate === null) rate = r;
      else if (Math.abs(r - rate) > rateTolerance) {
        runs.push({
          t0: trace[start].t,
          t1: trace[i - 1].t,
          ph0: trace[start].playhead,
          ph1: trace[i - 1].playhead,
        });
        start = i - 1;
        rate = r;
      }
    }
    if (trace.length - 1 > start) {
      runs.push({
        t0: trace[start].t,
        t1: trace[trace.length - 1].t,
        ph0: trace[start].playhead,
        ph1: trace[trace.length - 1].playhead,
      });
    }
  }
  return runs.filter((r) => r.t1 > r.t0);
}

/** The audibility area chart: a deck-color fill behind the waveform whose
 * height tracks the audible Master gain (50% gain — trim-center nominal —
 * reads as a FULL lane; 0 = empty). */
export function drawAudibilityArea(
  ctx: CanvasRenderingContext2D,
  steps: GainStep[],
  axis: TimeAxis,
  color: string,
  geo: LaneGeometry
): void {
  if (steps.length === 0) return;
  ctx.fillStyle = `rgba(${hexToRgbTriplet(color)}, 0.16)`;
  ctx.beginPath();
  const from = Math.max(0, Math.floor(geo.x0));
  const to = Math.min(geo.width, Math.ceil(geo.x1));
  // Monotonic cursors (sessions 22): x advances left→right, so both the
  // axis lookup and the step lookup ride advancing indices instead of a
  // per-pixel scan/binary search.
  const pxToT = createMonotonicPxToT(axis);
  let si = -1; // last step with steps[si].t <= t (-1 = before the first)
  for (let x = from; x < to; x++) {
    const t = pxToT(x);
    while (si + 1 < steps.length && steps[si + 1].t <= t) si++;
    const gain = si >= 0 ? steps[si].gain : 0;
    if (gain <= 0) continue;
    const h = Math.min(1, gain / 0.5) * geo.height;
    ctx.rect(x, geo.yOffset + geo.height - h, 1, h);
  }
  ctx.fill();
}

/** The nominal channel strip's Master gain (fader full, trim center):
 * the display normalizer — a deck played at defaults renders unmodulated,
 * mirroring drawAudibilityArea's "trim-center nominal reads as full". */
const NOMINAL_STRIP_GAIN = trimToGain(0.5) * channelFaderToGain(1);

/** Control lookup with the strip default before the first step / on an
 * empty series (defensive: deriveTimeline seeds every series at start). */
function controlAt(steps: GainStep[], t: number, dflt: number): number {
  if (steps.length === 0 || t < steps[0].t) return dflt;
  return gainAt(steps, t);
}

/** The recorded mixer state at session time `t` as a column modulation:
 * EQ per band group through its real curve (a kill removes the band), and
 * fader (audio taper) × trim (dB curve) as a display-normalized height
 * scale. Boosts above nominal fatten the body — the column pass clamps
 * heights at the lane rail (meter-pinning), and the 2× saturation matches
 * the live deck waveform's mod-texture ceiling (one look across surfaces).
 * Render-only — audibility definitions are untouched. */
export function columnModulation(controls: DeckControlSteps, t: number): ColumnModulation {
  const fader = controlAt(controls.fader, t, DECK_CONTROL_DEFAULTS.fader);
  const trim = controlAt(controls.trim, t, DECK_CONTROL_DEFAULTS.trim);
  const gain = channelFaderToGain(fader) * trimToGain(trim);
  return {
    eq: [
      eqValueToGain(controlAt(controls.eqLow, t, DECK_CONTROL_DEFAULTS.eqLow)),
      eqValueToGain(controlAt(controls.eqMid, t, DECK_CONTROL_DEFAULTS.eqMid)),
      eqValueToGain(controlAt(controls.eqHigh, t, DECK_CONTROL_DEFAULTS.eqHigh)),
    ],
    scale: Math.min(2, gain / NOMINAL_STRIP_GAIN),
  };
}

/** Full-color styled waveform for every constant-rate run of the deck's
 * traces, mirrored around the lane center (the editor's anchor). With
 * `controls`, each column is modulated by the recorded mixer state at its
 * session time (O(log n) step lookups — the gainAt precedent). */
export function drawStyledRuns(
  ctx: CanvasRenderingContext2D,
  wave: DecodedWaveform,
  styleId: string,
  params: StyleParams,
  runs: TraceRun[],
  axis: TimeAxis,
  geo: LaneGeometry,
  controls?: DeckControlSteps
): void {
  const midY = geo.yOffset + geo.height / 2;
  const halfH = geo.height / 2 - 2;
  // One interpreter for ALL runs (sessions 22): per-run sampler setup
  // dominated low-zoom redraws (thousands of visible runs), and the
  // modulation's px→t lookups ride a monotonic segment cursor (runs and
  // their columns advance left→right).
  const renderer = createStyledColumnRenderer(wave, styleId, params);
  const pxToT = controls ? createMonotonicPxToT(axis) : null;
  // Run endpoints advance in time — a monotonic cursor instead of
  // `axis.tToPx`'s per-call linear segment scan (O(runs × segments)
  // dominated low-zoom repaints alongside per-run setup).
  const tToPx = createMonotonicTToPx(axis);
  for (const run of runs) {
    const rx0 = tToPx(run.t0);
    const rx1 = tToPx(run.t1);
    if (rx1 <= rx0) continue;
    // Clip the run to the visible window, track range proportionally.
    const cx0 = Math.max(rx0, geo.x0);
    const cx1 = Math.min(rx1, geo.x1);
    if (cx1 <= cx0) continue;
    const phA = run.ph0 + ((cx0 - rx0) / (rx1 - rx0)) * (run.ph1 - run.ph0);
    const phB = run.ph0 + ((cx1 - rx0) / (rx1 - rx0)) * (run.ph1 - run.ph0);
    const xStart = Math.round(cx0);
    const cols = Math.round(cx1) - xStart;
    if (cols <= 0) continue;
    const modulate =
      controls && pxToT
        ? (x: number) => columnModulation(controls, pxToT(xStart + x + 0.5))
        : undefined;
    const columns = renderer.render(phA, phB, cols, 1, modulate);
    for (let x = 0; x < cols; x++) {
      const col = columns[x];
      if (col.outOfTrack) continue;
      for (const seg of col.segments) {
        ctx.fillStyle = seg.css;
        const y0 = seg.y0 * halfH;
        const y1 = seg.y1 * halfH;
        // Mirrored body: one rect per half per segment.
        ctx.fillRect(xStart + x, midY - y1, 1, y1 - y0);
        ctx.fillRect(xStart + x, midY + y0, 1, y1 - y0);
      }
    }
  }
}

/** Beat gridlines, mapped through the runs (jump/pitch-aware): faint
 * lines at beats, brighter at downbeats. Density-gated: downbeats appear
 * from ~4px spacing, all beats from ~10px. */
export function drawGridlines(
  ctx: CanvasRenderingContext2D,
  beatTimes: number[],
  downbeatTimes: number[],
  runs: TraceRun[],
  axis: TimeAxis,
  geo: LaneGeometry
): void {
  const downbeats = new Set(downbeatTimes);
  const tToPx = createMonotonicTToPx(axis);
  for (const run of runs) {
    const x0 = tToPx(run.t0);
    const x1 = tToPx(run.t1);
    const phSpan = run.ph1 - run.ph0;
    if (phSpan <= 0 || x1 <= x0) continue;
    const pxPerTrackSec = (x1 - x0) / phSpan;
    // Estimate beat spacing from the grid itself (median-ish: first gap).
    const beatGapS = beatTimes.length > 1 ? beatTimes[1] - beatTimes[0] : 0.5;
    const beatPx = beatGapS * pxPerTrackSec;
    const drawBeats = beatPx >= 10;
    const drawDownbeats = beatPx * 4 >= 16;
    if (!drawBeats && !drawDownbeats) continue;

    // Binary search the first beat ≥ ph0.
    let lo = 0;
    let hi = beatTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beatTimes[mid] < run.ph0) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < beatTimes.length && beatTimes[i] <= run.ph1; i++) {
      const b = beatTimes[i];
      const isDown = downbeats.has(b);
      if (!isDown && !drawBeats) continue;
      const x = x0 + (b - run.ph0) * pxPerTrackSec;
      if (x < geo.x0 || x > geo.x1) continue; // window
      ctx.fillStyle = isDown ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)';
      ctx.fillRect(Math.round(x), geo.yOffset + 2, 1, geo.height - 4);
    }
  }
}
