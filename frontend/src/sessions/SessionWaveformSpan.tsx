/**
 * One deck's waveform lane on the Session timeline (sessions 04): draws the
 * band-amplitude envelope of exactly the audio that played, mapped from
 * track time onto the session-time axis via the deck's playhead traces.
 *
 * A light 2D-canvas path (the OverviewLadder precedent), not the WebGL
 * renderer: the lane is static per scrub (no per-frame animation), so
 * four GPU contexts would be overkill. One monochrome envelope in the
 * Deck's identity color, dark where no waveform data exists yet.
 */
import { useEffect, useRef } from 'react';
import { useWaveformBlob } from '../waveform/useWaveformBlob';
import { toThreeBands } from '../waveform/blob';
import { hexToRgbTriplet } from '../theme/deckColors';
import type { DeckTimeline, TimeAxis, TrackSpan } from './timelineModel';
import { trackTimeAt } from './timelineModel';

interface Props {
  trackSpan: TrackSpan;
  deck: DeckTimeline;
  axis: TimeAxis;
  color: string;
  width: number;
  height: number;
  /** y offset of this lane within the shared canvas. */
  yOffset: number;
  /** Device-pixel-ratio-scaled canvas context to draw into (shared). */
  ctx: CanvasRenderingContext2D | null;
}

/**
 * Draws one track span's waveform into the shared lane canvas. Returns
 * nothing — a pure side-effecting draw keyed on its inputs. Rendered as a
 * hidden hook-bearing component (needs useWaveformBlob per track span).
 */
export function SessionWaveformSpan({
  trackSpan,
  deck,
  axis,
  color,
  width,
  height,
  yOffset,
  ctx,
}: Props) {
  const { data } = useWaveformBlob(trackSpan.trackId);
  const bandsRef = useRef<ReturnType<typeof toThreeBands> | null>(null);

  if (data && bandsRef.current === null) {
    bandsRef.current = toThreeBands(data);
  }

  useEffect(() => {
    if (!ctx) return;
    const bands = bandsRef.current;
    const x0 = Math.round(axis.tToX(trackSpan.start) * width);
    const x1 = Math.round(axis.tToX(trackSpan.end) * width);
    if (x1 <= x0) return;

    const midY = yOffset + height / 2;
    const halfH = height / 2 - 3;

    if (!bands) {
      // No waveform yet (still generating): a faint baseline so the lane
      // reads as "audio, not-yet-drawn" rather than empty.
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
    ctx.fillStyle = `rgba(${hexToRgbTriplet(color)}, 0.85)`;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const t = axis.xToT(x / width);
      const trackTime = trackTimeAt(deck, t);
      if (trackTime === null) continue;
      const f = Math.min(frames - 1, Math.max(0, Math.round((trackTime / dur) * frames)));
      // Envelope = the loudest of the three band groups at this frame.
      const amp = Math.max(bands.low[f], bands.mid[f], bands.high[f]);
      const h = amp * halfH;
      ctx.rect(x, midY - h, 1, h * 2);
    }
    ctx.fill();
  }, [ctx, data, axis, trackSpan, deck, color, width, height, yOffset]);

  return null;
}
