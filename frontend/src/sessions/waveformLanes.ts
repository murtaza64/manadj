/**
 * Waveform lane drawing for the Session timeline (sessions 04) — pure 2D
 * canvas helpers (the OverviewLadder precedent; no GPU renderer, the lane
 * is static per view state). Draws the band-amplitude envelope of exactly
 * the audio that played: session-time x-axis, track time resolved per
 * pixel column through the deck's playhead traces.
 */
import type { ThreeBandWaveform } from '../waveform/blob';
import { hexToRgbTriplet } from '../theme/deckColors';
import type { DeckTimeline, TimeAxis, TrackSpan } from './timelineModel';
import { trackTimeAt } from './timelineModel';

export interface SpanDrawGeometry {
  /** Full drawable width in CSS px. */
  width: number;
  /** Lane's y offset and height in CSS px. */
  yOffset: number;
  height: number;
}

/**
 * Draw one track span's waveform envelope into the lane. `bands` null =
 * blob not yet generated: draw a faint baseline so the lane reads as
 * "audio, not-yet-drawn" rather than empty.
 */
export function drawSpanWaveform(
  ctx: CanvasRenderingContext2D,
  bands: ThreeBandWaveform | null,
  span: TrackSpan,
  deck: DeckTimeline,
  axis: TimeAxis,
  color: string,
  geo: SpanDrawGeometry
): void {
  const x0 = Math.round(axis.tToX(span.start) * geo.width);
  const x1 = Math.round(axis.tToX(span.end) * geo.width);
  if (x1 <= x0) return;

  const midY = geo.yOffset + geo.height / 2;
  const halfH = geo.height / 2 - 4;

  if (!bands) {
    ctx.strokeStyle = `rgba(${hexToRgbTriplet(color)}, 0.25)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, midY);
    ctx.lineTo(x1, midY);
    ctx.stroke();
    return;
  }

  const frames = bands.low.length;
  const dur = bands.duration || 1;
  ctx.fillStyle = `rgba(${hexToRgbTriplet(color)}, 0.55)`;
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) {
    const t = axis.xToT(x / geo.width);
    const trackTime = trackTimeAt(deck, t);
    if (trackTime === null) continue;
    const f = Math.min(frames - 1, Math.max(0, Math.round((trackTime / dur) * frames)));
    // Envelope = the loudest of the three band groups at this frame.
    const amp = Math.max(bands.low[f], bands.mid[f], bands.high[f]);
    const h = Math.max(0.5, amp * halfH);
    ctx.rect(x, midY - h, 1, h * 2);
  }
  ctx.fill();
}
