/**
 * "Waves" preset (realtime-visualization 02): cava's parabolic "waves"
 * spread rendered as a smooth glowing mountain — the spectrum melts into
 * a silhouette instead of discrete bars. Filled with a saturated
 * hue-drifting gradient; a hot ridge line traces the crest.
 */

import { energyHue, energyOf } from '../style';
import { wavesSpread } from '../bands';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const HUE_DRIFT_DEG_PER_S = 10;

class WavesRenderer implements PresetRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const levels = wavesSpread(frame.spectrum);
    const count = levels.length;
    if (count === 0) return;

    const baseY = height * 0.9;
    const maxHeight = height * 0.75;
    const hue = energyHue(energyOf(frame.bands), frame.time * HUE_DRIFT_DEG_PER_S);

    // Smooth curve through band points: quadratic segments through
    // midpoints (the standard polyline smoother).
    const xAt = (i: number) => (i / (count - 1)) * width;
    const yAt = (i: number) => baseY - levels[i] * maxHeight;

    const ridge = new Path2D();
    ridge.moveTo(xAt(0), yAt(0));
    for (let i = 1; i < count - 1; i++) {
      ridge.quadraticCurveTo(xAt(i), yAt(i), (xAt(i) + xAt(i + 1)) / 2, (yAt(i) + yAt(i + 1)) / 2);
    }
    ridge.lineTo(xAt(count - 1), yAt(count - 1));

    const fill = new Path2D(ridge);
    fill.lineTo(width, baseY);
    fill.lineTo(0, baseY);
    fill.closePath();

    const gradient = ctx.createLinearGradient(0, baseY, 0, baseY - maxHeight);
    gradient.addColorStop(0, `hsla(${hue}, 100%, 30%, 0.9)`);
    gradient.addColorStop(0.6, `hsl(${(hue + 40) % 360}, 100%, 48%)`);
    gradient.addColorStop(1, `hsl(${(hue + 80) % 360}, 100%, 60%)`);
    ctx.fillStyle = gradient;
    ctx.fill(fill);

    // Crest line, brighter with overall energy.
    const energy = Math.max(frame.bands.low, frame.bands.mid, frame.bands.high);
    ctx.strokeStyle = `hsla(${(hue + 80) % 360}, 100%, ${65 + 25 * energy}%, ${0.6 + 0.4 * energy})`;
    ctx.lineWidth = Math.max(2, height * 0.004);
    ctx.stroke(ridge);

    // Mirrored faint reflection below the baseline.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.translate(0, baseY * 2);
    ctx.scale(1, -1);
    ctx.fillStyle = gradient;
    ctx.fill(fill);
    ctx.restore();
  }
}

export const wavesPreset: VisualizerPreset = {
  id: 'waves',
  name: 'Waves',
  create: () => new WavesRenderer(),
};
