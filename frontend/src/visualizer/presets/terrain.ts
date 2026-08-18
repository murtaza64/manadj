/**
 * "Terrain" preset (realtime-visualization 02): spectrum history as a
 * mountain range scrolling toward the viewer — Vissonance's Fracture/
 * HillFog reduced to canvas 2D. Each captured spectrum row becomes a
 * ridge; rows recede toward a horizon with perspective shrink and depth
 * fade (their shader's -z brightness), and scroll speed rides the energy
 * so drops physically accelerate the landscape. Bass sits mid-range so
 * the center of every ridge is the mountain.
 */

import { wavesSpread } from '../bands';
import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const ROWS = 26;
const MIN_ROWS_PER_S = 6;
const MAX_ROWS_PER_S = 22;
/** Perspective exponent: how fast rows bunch toward the horizon. */
const PERSPECTIVE = 1.9;

class TerrainRenderer implements PresetRenderer {
  private history: number[][] = [];
  private rowPhase = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const energy = energyOf(frame.bands);
    const hue = energyHue(energy);

    // Capture rows at an energy-driven rate (Fracture: scroll ∝ loudness).
    this.rowPhase += (MIN_ROWS_PER_S + (MAX_ROWS_PER_S - MIN_ROWS_PER_S) * energy) * frame.dt;
    while (this.rowPhase >= 1) {
      this.rowPhase -= 1;
      this.history.unshift(wavesSpread(frame.spectrum, 1 / 32));
      if (this.history.length > ROWS) this.history.pop();
    }
    if (this.history.length === 0) return;

    const horizonY = height * 0.28;
    const frontY = height * 0.94;
    const maxRidgeHeight = height * 0.34;

    // Back-to-front: each row is a filled silhouette that occludes the
    // rows behind it, with a bright ridge line on top.
    for (let r = this.history.length - 1; r >= 0; r--) {
      const row = this.history[r];
      // Depth 0 = front. rowPhase eases rows between slots so the
      // landscape glides instead of stepping.
      const depth = Math.min(1, (r + this.rowPhase) / ROWS);
      const nearness = Math.pow(1 - depth, PERSPECTIVE);
      const baseY = horizonY + (frontY - horizonY) * nearness;
      const spanScale = 0.3 + 0.7 * nearness;
      const span = width * spanScale;
      const left = (width - span) / 2;
      const ridgeHeight = maxRidgeHeight * (0.15 + 0.85 * nearness);

      // Mirror the bands: bass at the center peak, highs at the edges.
      const points = row.length * 2;
      const path = new Path2D();
      path.moveTo(left, baseY);
      for (let p = 0; p < points; p++) {
        const band = p < row.length ? row.length - 1 - p : p - row.length;
        const x = left + (span * (p + 0.5)) / points;
        path.lineTo(x, baseY - row[band] * ridgeHeight);
      }
      path.lineTo(left + span, baseY);

      const fade = 0.12 + 0.88 * nearness;
      // Opaque fill (black toward the base) so nearer ridges occlude.
      const fill = ctx.createLinearGradient(0, baseY - ridgeHeight, 0, baseY);
      fill.addColorStop(0, `hsl(${hue}, 100%, ${10 + 22 * fade}%)`);
      fill.addColorStop(1, '#000');
      ctx.fillStyle = fill;
      ctx.fill(path);
      ctx.strokeStyle = `hsla(${hue}, 100%, ${45 + 30 * fade}%, ${fade})`;
      ctx.lineWidth = Math.max(1, height * 0.0022 * (0.4 + 0.6 * nearness));
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }

    // Horizon glow.
    const glow = ctx.createLinearGradient(0, horizonY - height * 0.1, 0, horizonY + height * 0.06);
    glow.addColorStop(0, 'hsla(0, 0%, 0%, 0)');
    glow.addColorStop(0.6, `hsla(${(hue + 30) % 360}, 100%, 55%, ${0.12 + 0.2 * energy})`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizonY - height * 0.1, width, height * 0.16);
  }
}

export const terrainPreset: VisualizerPreset = {
  id: 'terrain',
  name: 'Terrain',
  create: () => new TerrainRenderer(),
};
