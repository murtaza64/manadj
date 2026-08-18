/**
 * "Goniometer" preset (realtime-visualization 02): the stereo Lissajous /
 * vectorscope — L/R plotted in the 45°-rotated mid/side frame, the
 * standard studio stereo-width view (mono = a vertical line, wide = a
 * cloud). Phosphor persistence; cyan trace with hot core. DJ-relevant:
 * shows mono-compatibility of the master at a glance.
 */

import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const INV_SQRT2 = Math.SQRT1_2;

class GonioRenderer implements PresetRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    // Phosphor decay.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scale = unit * 0.42;

    // Graticule: the L/R diagonals and mono axis.
    ctx.strokeStyle = 'hsla(180, 100%, 50%, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - scale, cy + scale);
    ctx.lineTo(cx + scale, cy - scale);
    ctx.moveTo(cx - scale, cy - scale);
    ctx.lineTo(cx + scale, cy + scale);
    ctx.moveTo(cx, cy - scale);
    ctx.lineTo(cx, cy + scale);
    ctx.stroke();

    const wave = frame.wave;
    if (!wave || wave.left.length === 0) return;
    const { left, right } = wave;
    const n = Math.min(left.length, right.length);
    const energy = Math.max(frame.bands.low, frame.bands.mid, frame.bands.high);

    // Connected trace: side (L-R) on x, mid (L+R) on y — the 45° rotation.
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = cx + (left[i] - right[i]) * INV_SQRT2 * scale;
      const y = cy - (left[i] + right[i]) * INV_SQRT2 * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `hsla(180, 100%, ${55 + 25 * energy}%, 0.55)`;
    ctx.lineWidth = Math.max(1.5, unit * 0.002);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

export const gonioPreset: VisualizerPreset = {
  id: 'gonio',
  name: 'Gonio',
  wantsWave: true,
  create: () => new GonioRenderer(),
};
