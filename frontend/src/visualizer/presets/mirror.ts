/**
 * "Mirror" preset (realtime-visualization 02): Monstercat-skin-style
 * center-out mirrored bars — 24 bands unfold from the center line to both
 * sides (48 columns), each bar growing symmetrically up and down from the
 * horizontal axis. Single saturated hue drifting slowly; monstercat
 * spread keeps hits reading as shapes.
 */

import { energyHue, energyOf } from '../style';
import { monstercatSpread } from '../bands';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const HUE_DRIFT_DEG_PER_S = 6;
const SPREAD_FACTOR = 1.7;

class MirrorRenderer implements PresetRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const levels = monstercatSpread(frame.spectrum, SPREAD_FACTOR);
    const count = levels.length;
    if (count === 0) return;

    const columns = count * 2;
    const margin = width * 0.04;
    const span = width - margin * 2;
    const gap = span / columns / 4;
    const barWidth = (span - gap * (columns - 1)) / columns;
    const cy = height / 2;
    const maxHalfHeight = height * 0.42;
    const hue = energyHue(energyOf(frame.bands), frame.time * HUE_DRIFT_DEG_PER_S);

    for (let cIndex = 0; cIndex < columns; cIndex++) {
      // Low bands at the center, highs unfolding outward on both sides.
      const half = columns / 2;
      const band = cIndex < half ? half - 1 - cIndex : cIndex - half;
      const level = levels[band];
      if (level <= 0.004) continue;
      const x = margin + cIndex * (barWidth + gap);
      const halfHeight = Math.max(1, level * maxHalfHeight);
      ctx.fillStyle = `hsl(${hue}, 100%, ${40 + 30 * level}%)`;
      ctx.fillRect(x, cy - halfHeight, barWidth, halfHeight * 2);
      // Hot tips top and bottom.
      const tip = Math.min(halfHeight, Math.max(2, height * 0.004));
      ctx.fillStyle = `hsla(${hue}, 100%, 80%, ${0.5 + 0.5 * level})`;
      ctx.fillRect(x, cy - halfHeight, barWidth, tip);
      ctx.fillRect(x, cy + halfHeight - tip, barWidth, tip);
    }

    // Center axis.
    ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.3)`;
    ctx.fillRect(margin, cy - 0.5, span, 1);
  }
}

export const mirrorPreset: VisualizerPreset = {
  id: 'mirror',
  name: 'Mirror',
  create: () => new MirrorRenderer(),
};
