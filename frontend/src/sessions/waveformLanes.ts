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
import { computeStyledColumns } from '../sets/ladderWaveStyle';
import { hexToRgbTriplet } from '../theme/deckColors';
import { channelFaderToGain, trimToGain } from '../playback/mixerMath';
import { eqValueToGain } from '../playback/graph';
import type { DeckControlSteps, DeckTimeline, GainStep, TimeAxis } from './timelineModel';
import { DECK_CONTROL_DEFAULTS, gainAt } from './timelineModel';

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

/** A constant-rate stretch of one playhead trace: session [t0,t1] maps
 * linearly onto track [ph0,ph1]. */
export interface TraceRun {
  t0: number;
  t1: number;
  ph0: number;
  ph1: number;
}

/** Cut traces into constant-rate runs (rate changes at pitch moves; the
 * ~1 Hz samples make same-rate stretches long). Tolerance is generous —
 * a run is a RENDER unit, not evidence. */
export function traceRuns(deck: DeckTimeline, rateTolerance = 0.04): TraceRun[] {
  const runs: TraceRun[] = [];
  for (const trace of deck.traces) {
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
  for (let x = from; x < to; x++) {
    const gain = gainAt(steps, axis.pxToT(x));
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
 * scale, capped at 1 (a boosted strip must not overflow the lane).
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
    scale: Math.min(1, gain / NOMINAL_STRIP_GAIN),
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
  for (const run of runs) {
    const rx0 = axis.tToPx(run.t0);
    const rx1 = axis.tToPx(run.t1);
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
    const modulate = controls
      ? (x: number) => columnModulation(controls, axis.pxToT(xStart + x + 0.5))
      : undefined;
    const columns = computeStyledColumns(wave, styleId, params, phA, phB, cols, 1, modulate);
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
  for (const run of runs) {
    const x0 = axis.tToPx(run.t0);
    const x1 = axis.tToPx(run.t1);
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
