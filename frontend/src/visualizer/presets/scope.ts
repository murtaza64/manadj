/**
 * "Scope" preset (realtime-visualization 02): a triggered oscilloscope —
 * the raw master waveform, the punchiest signal there is (butterchurn
 * works from time-domain data for exactly this reason). Rising-edge
 * trigger stabilizes the trace; a translucent wash gives phosphor
 * persistence; classic green, brightness riding the signal.
 */

import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

/** Portion of the buffer searched for a trigger point. */
const TRIGGER_SEARCH = 0.5;

class ScopeRenderer implements PresetRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    // Phosphor decay instead of a full clear.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, width, height);

    const wave = frame.wave;
    const cy = height / 2;

    // Graticule center line.
    ctx.fillStyle = 'hsla(130, 100%, 50%, 0.15)';
    ctx.fillRect(0, cy - 0.5, width, 1);

    if (!wave || wave.left.length === 0) return;
    const { left, right } = wave;
    const n = Math.min(left.length, right.length);

    // Mid (mono) signal; the scope reads the mix, not one side.
    // Rising-edge zero-cross trigger in the front half keeps the trace
    // phase-stable instead of scrolling.
    let trigger = 0;
    const searchEnd = Math.floor(n * TRIGGER_SEARCH);
    for (let i = 1; i < searchEnd; i++) {
      const prev = (left[i - 1] + right[i - 1]) / 2;
      const curr = (left[i] + right[i]) / 2;
      if (prev < 0 && curr >= 0) {
        trigger = i;
        break;
      }
    }

    const span = n - Math.floor(n * TRIGGER_SEARCH);
    const amplitude = height * 0.42;
    const energy = Math.max(frame.bands.low, frame.bands.mid, frame.bands.high);

    ctx.beginPath();
    for (let i = 0; i < span; i++) {
      const s = (left[trigger + i] + right[trigger + i]) / 2;
      const x = (i / (span - 1)) * width;
      const y = cy - s * amplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsl(130, 100%, ${50 + 30 * energy}%)`;
    ctx.lineWidth = Math.max(2, height * 0.004);
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Glow pass.
    ctx.strokeStyle = `hsla(130, 100%, 60%, 0.25)`;
    ctx.lineWidth = Math.max(6, height * 0.012);
    ctx.stroke();
  }
}

export const scopePreset: VisualizerPreset = {
  id: 'scope',
  name: 'Scope',
  wantsWave: true,
  create: () => new ScopeRenderer(),
};
