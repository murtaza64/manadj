/**
 * Lane deviation shading (mix-editor 39) — pure, under vitest.
 *
 * Lanes used to encode absolute position; the question the eye asks is
 * DEVIATION FROM NEUTRAL. This module gives the renderer one vocabulary
 * for that: each lane's neutral value, a normalized deviation, and the
 * grey→deck-color ramp with per-kind fill semantics:
 *
 * - EQ (RGB experiment, walkthrough 2026-08-24): ABSOLUTE-value ramp —
 *   the fill runs all the way from MIN to the curve, grading grey at min
 *   through partially saturated/opaque at neutral to fully saturated at
 *   max. The band reads as energy present, like the faders, not as a
 *   deviation. Neutral is still center (the guide line), but grey no
 *   longer means "untouched" here — it means killed.
 * - Fader: neutral = EMPTY (bottom) — grey means NO ENERGY, color means
 *   energy present (walkthrough feedback; this deliberately diverges from
 *   the vectorizer's resting default of FULL). The fill is the under-curve
 *   area (DAW-style): full fader = full lane, at constant alpha — height
 *   already encodes the level.
 * - Filter: bipolar around center; the LPF side blends the hue darker
 *   (cutting highs), the HPF side lighter (cutting lows) — direction is
 *   the whole point of a filter move.
 *
 * "Looks neutral" shares the vectorizer's OFF_DEFAULT_EPS. For filters
 * that means grey = exactly what the vectorizer calls untouched; faders
 * reference EMPTY, and EQ renders neutral at partial strength.
 */
import { OFF_DEFAULT_EPS } from '../capture/vectorize';
import type { LaneId } from './mixModel';

/** Within this of neutral, a value renders as neutral (grey). */
export const NEUTRAL_EPS = OFF_DEFAULT_EPS;

/** Normalized deviation at which the ramp reaches full deck color.
 * 0.3 saturated ~25% of the strip away from neutral — too eager: most of
 * a real move rendered at max strength (walkthrough feedback). */
const RAMP_FULL = 0.6;

/** Fader fills are ENERGY PRESENT, not move size: constant alpha — the
 * fill's height already encodes the level, and riding the deviation ramp
 * read inverted (full fader = faintest area). The stroke keeps the ramp. */
const FADER_FILL_ALPHA = 0.15;

/** Greys for at-neutral rendering. */
const NEUTRAL_STROKE = { r: 140, g: 140, b: 150 };
const NEUTRAL_STROKE_ALPHA = 0.5;

/** The lane's neutral value in lane domain (0..1). */
export function laneNeutral(id: LaneId): number {
  return id.startsWith('fader') ? 0 : 0.5;
}

/** Where the fill anchors, in lane domain. Filters fill from their
 * neutral center (bipolar); faders and EQ fill from MIN — the area reads
 * as energy present. */
export function laneFillAnchor(id: LaneId): number {
  return id.startsWith('filter') ? 0.5 : 0;
}

/** Deviation from neutral, normalized to 0..1 over the lane's reachable
 * range on that side (fader can travel 1 above neutral; the rest 0.5
 * either side). */
export function laneDeviation(id: LaneId, y: number): number {
  const n = laneNeutral(id);
  const range = id.startsWith('fader') ? 1 : 0.5;
  return Math.min(1, Math.abs(y - n) / range);
}

/** Is this value effectively neutral (the vectorizer's own epsilon)? */
export function isNeutral(id: LaneId, y: number): boolean {
  return Math.abs(y - laneNeutral(id)) <= NEUTRAL_EPS;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function mix(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

const rgba = (c: { r: number; g: number; b: number }, a: number): string =>
  `rgba(${c.r},${c.g},${c.b},${a})`;

/** Resting default (untouched) value per lane — matches the vectorizer's
 * restingDefault: faders sit FULL, EQ/filter at center. */
export function laneRestingDefault(id: LaneId): number {
  return id.startsWith('fader') ? 1 : 0.5;
}

/** Shade for an EMPTY lane (no breakpoints): a flat line at the resting
 * default, stroke and fill both in the neutral grey — the lane reads as
 * present-but-untouched instead of vanishing entirely (walkthrough
 * feedback). The fill spans from the lane's fill anchor to the line. */
export function emptyLaneShade(id: LaneId): { y: number; stroke: string; fill: string } {
  return {
    y: laneRestingDefault(id),
    stroke: rgba(NEUTRAL_STROKE, NEUTRAL_STROKE_ALPHA),
    fill: rgba(NEUTRAL_STROKE, 0.08),
  };
}

/** Stroke color for a point value: grey at the ramp's floor (neutral for
 * fader/filter, MIN for EQ), ramping to the lane color. */
export function pointStroke(id: LaneId, color: string, y: number): string {
  if (!id.startsWith('eq') && isNeutral(id, y)) {
    return rgba(NEUTRAL_STROKE, NEUTRAL_STROKE_ALPHA + 0.2);
  }
  const t = rampT(id, y);
  return rgba(mix(NEUTRAL_STROKE, hexToRgb(color), t), 0.6 + 0.4 * t);
}

/** One gradient stop along a segment, at `offset` (0 at the segment's
 * start, 1 at its end). */
export interface FillStop {
  offset: number;
  color: string;
}

export interface SegmentShade {
  /** Curve stroke as gradient stops along the segment — grey at neutral
   * ramping to the deck color, tracking the INTERPOLATED value like the
   * fill (walkthrough feedback: a flat max-endpoint stroke read wrong on
   * long ramps). For a degenerate (vertical/short) span the renderer falls
   * back to the strongest endpoint, so slams still read at full strength
   * immediately. */
  stroke: FillStop[];
  /** Fill between the curve and the neutral axis, as gradient stops along
   * the segment — the alpha tracks the INTERPOLATED value, so a triangular
   * ramp fades with the parameter instead of wearing its far endpoint's
   * strength across the whole area (walkthrough feedback). The alpha ramp
   * is piecewise-linear in y (kink where the value crosses neutral, clamp
   * where it saturates at RAMP_FULL), and stops sit exactly on those
   * crossings, so the gradient is exact. null = no fill (the segment sits
   * at neutral). */
  fill: FillStop[] | null;
}

/** Deck hue at value y: filters blend by SIDE — LPF toward black, HPF
 * toward white. */
function hueAt(id: LaneId, color: string, y: number): { r: number; g: number; b: number } {
  const c = hexToRgb(color);
  if (!id.startsWith('filter')) return c;
  return y >= 0.5
    ? mix(c, { r: 255, g: 255, b: 255 }, 0.45) // HPF: lows cut — airier
    : mix(c, { r: 0, g: 0, b: 0 }, 0.35); // LPF: highs cut — darker
}

/** Color-ramp progress at value y. EQ and FADER: ABSOLUTE — 0 at min, 1
 * at max, linear with no clamp, so the whole 0→1 travel stays perceivable
 * (clamping at RAMP_FULL rendered 0.6..1.0 identically — walkthrough
 * feedback). Filter: deviation from center, saturating at RAMP_FULL (its
 * reachable range is half a strip; the boost keeps small moves visible). */
function rampT(id: LaneId, y: number): number {
  if (id.startsWith('filter')) return Math.min(1, laneDeviation(id, y) / RAMP_FULL);
  return y;
}

/** Fill color of lane `id` at value y: hue per side, alpha following the
 * ramp. Faders: constant (see FADER_FILL_ALPHA). EQ: the COLOR grades
 * too — grey at min through partial at neutral to the full band color at
 * max (RGB experiment). */
function fillColorAt(id: LaneId, color: string, y: number): string {
  const c = hueAt(id, color, y);
  if (id.startsWith('fader')) return rgba(c, FADER_FILL_ALPHA);
  const t = rampT(id, y);
  if (id.startsWith('eq')) return rgba(mix(NEUTRAL_STROKE, c, t), 0.05 + 0.35 * t);
  return rgba(c, 0.1 + 0.3 * t);
}

/** Stroke color of lane `id` at value y: the same grey→deck-color ramp
 * as pointStroke, hue per side for filters. */
function strokeColorAt(id: LaneId, color: string, y: number): string {
  const t = rampT(id, y);
  return rgba(mix(NEUTRAL_STROKE, hueAt(id, color, y), t), 0.6 + 0.4 * t);
}

/** Gradient stops for `colorAt` along the segment y0→y1: endpoints plus
 * every ramp breakpoint the segment crosses — where the value passes
 * neutral (the |y-n| kink; also the filter's hue switch, which gets twin
 * stops for a HARD side flip) and where deviation saturates at RAMP_FULL
 * on either side. Between consecutive stops the color is linear in y (and
 * y is linear along the segment), so the gradient tracks the ramp
 * exactly. */
function segmentStops(
  id: LaneId,
  color: string,
  y0: number,
  y1: number,
  colorAt: (id: LaneId, color: string, y: number) => string
): FillStop[] {
  const n = laneNeutral(id);
  const range = id.startsWith('fader') ? 1 : 0.5;
  const stops: FillStop[] = [{ offset: 0, color: colorAt(id, color, y0) }];
  if (y1 !== y0) {
    const crossings = [n, n + RAMP_FULL * range, n - RAMP_FULL * range]
      .map((yc) => (yc - y0) / (y1 - y0))
      .filter((o) => o > 0 && o < 1)
      .sort((a, b) => a - b);
    for (const o of crossings) {
      const y = y0 + (y1 - y0) * o;
      if (id.startsWith('filter') && Math.abs(y - n) < 1e-9) {
        // The hue split is a SIDE, not a blend: two stops at the same
        // offset switch LPF-dark to HPF-light hard at the axis.
        const eps = Math.sign(y1 - y0) * 1e-4;
        stops.push({ offset: o, color: colorAt(id, color, y - eps) });
        stops.push({ offset: o, color: colorAt(id, color, y + eps) });
      } else {
        stops.push({ offset: o, color: colorAt(id, color, y) });
      }
    }
  }
  stops.push({ offset: 1, color: colorAt(id, color, y1) });
  return stops;
}

/** Shade for one straight lane segment spanning values y0..y1: stroke and
 * fill are both per-value gradients (see SegmentShade). */
export function segmentShade(id: LaneId, color: string, y0: number, y1: number): SegmentShade {
  // EQ never takes the neutral shortcut: its ramp is absolute, so a
  // neutral segment legitimately renders a partial-strength fill from min.
  const bothNeutral = !id.startsWith('eq') && isNeutral(id, y0) && isNeutral(id, y1);
  if (bothNeutral) {
    // No fill at neutral. For faders this is geometric anyway: neutral =
    // EMPTY = the fill anchor, so the area has zero height.
    const grey = rgba(NEUTRAL_STROKE, NEUTRAL_STROKE_ALPHA);
    return {
      stroke: [
        { offset: 0, color: grey },
        { offset: 1, color: grey },
      ],
      fill: null,
    };
  }
  return {
    stroke: segmentStops(id, color, y0, y1, strokeColorAt),
    fill: segmentStops(id, color, y0, y1, fillColorAt),
  };
}
