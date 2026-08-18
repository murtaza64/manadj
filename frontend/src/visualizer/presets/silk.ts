/**
 * "Silk" preset (realtime-visualization 02): a port of Vissonance's Silk —
 * its signature is MOTION-AS-TRAIL: a row of dots, one per band, DRIFTS
 * away from the center axis at a speed set by its band's level, leaving
 * persistence trails (no full clear) that weave silky threads; a dot
 * resets to the axis when it drifts out or the music goes quiet. Kept
 * 4-way mirrored (their four cloned groups) on the black stage with
 * saturated color — their white-canvas pastel look inverts here per the
 * project's saturated-colors convention (the thread geometry is the
 * point, not the paper).
 */

import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

/** Trail persistence: lower = longer threads. */
const WASH_ALPHA = 0.045;
/** Drift speed at band level 1, unit-fractions/s (their 4·log10 rise). */
const DRIFT_PER_S = 0.34;
/** Reset bound (their ±30 world units). */
const DRIFT_MAX = 0.42;
const QUIET_ENERGY = 0.03;

class SilkRenderer implements PresetRenderer {
  /** One drift offset per band, shared by the four mirrored copies. */
  private drift: number[] = [];

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    // Persistence wash — the threads live in the layer's history.
    ctx.fillStyle = `rgba(0, 0, 0, ${WASH_ALPHA})`;
    ctx.fillRect(0, 0, width, height);

    const levels = frame.spectrum;
    const count = levels.length;
    if (this.drift.length < count) this.drift = new Array<number>(count).fill(0);

    const energy = energyOf(frame.bands);
    const hue = energyHue(energy, frame.time * 4);
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const spanX = width * 0.46;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i++) {
      const level = levels[i];
      // Silk's rise: drift by the band's level; reset out of bounds or on
      // silence — a loud sustained band draws a long unbroken thread.
      this.drift[i] += level * DRIFT_PER_S * frame.dt * (1 + 2.2 * level);
      if (this.drift[i] > DRIFT_MAX || energy < QUIET_ENERGY) this.drift[i] = 0;

      const x = ((i + 0.5) / count) * spanX;
      const y = this.drift[i] * unit;
      const size = unit * (0.0025 + 0.012 * Math.log10(1 + level * 9));
      const lightness = 55 + 30 * level;
      const bandHue = (hue + i * 1.6) % 360;
      ctx.fillStyle = `hsla(${bandHue}, 100%, ${lightness}%, ${0.35 + 0.65 * level})`;
      // Four mirrored copies (their group/group2/group3/group4).
      for (const [sx, sy] of [
        [1, -1],
        [-1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + sx * x, cy + sy * y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

export const silkPreset: VisualizerPreset = {
  id: 'silk',
  name: 'Silk',
  create: () => new SilkRenderer(),
};
