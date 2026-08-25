/**
 * "Fracture" preset (realtime-visualization 02): a canvas-2D port of
 * Vissonance's Fracture — mirrored spectrum terrain as FLOOR and CEILING
 * scrolling toward the viewer, with its two signature moves: the whole
 * scene ROLLS continuously (camera roll ∝ loudness²) and the floor/
 * ceiling gap CLOSES as the track gets louder, jaws almost meeting on a
 * drop. One energy-swept hue; depth fade toward the horizon.
 */

import { wavesSpread } from '../bands';
import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const ROWS = 18;
const MIN_ROWS_PER_S = 5;
const MAX_ROWS_PER_S = 20;
const PERSPECTIVE = 1.8;
/** Camera roll speed at full energy, radians/s (their pow((l/8192)+1,2)-1). */
const MAX_ROLL_RAD_PER_S = 0.55;

class FractureRenderer implements PresetRenderer {
  private history: number[][] = [];
  private rowPhase = 0;
  private roll = 0;

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

    this.rowPhase += (MIN_ROWS_PER_S + (MAX_ROWS_PER_S - MIN_ROWS_PER_S) * energy) * frame.dt;
    while (this.rowPhase >= 1) {
      this.rowPhase -= 1;
      this.history.unshift(wavesSpread(frame.spectrum, 1 / 32));
      if (this.history.length > ROWS) this.history.pop();
    }
    this.roll += (0.04 + MAX_ROLL_RAD_PER_S * energy * energy + 0.5 * frame.impulse.mid) * frame.dt;
    if (this.history.length === 0) return;

    const cx = width / 2;
    const cy = height / 2;
    // The jaws: floor/ceiling baselines close toward center when loud.
    // Jaws: baseline closes with sustained energy; a kick SNAPS them
    // (impulse) — a drop's first kick visibly bites (05).
    const gap = height * (0.46 - 0.3 * energy) * (1 - 0.18 * frame.impulse.low);
    const ridgeHeight = height * 0.22;
    const diagonal = Math.hypot(width, height);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.roll);

    for (const side of [1, -1] as const) {
      for (let r = this.history.length - 1; r >= 0; r--) {
        const row = this.history[r];
        const depth = Math.min(1, (r + this.rowPhase) / ROWS);
        const nearness = Math.pow(1 - depth, PERSPECTIVE);
        // Rows recede upward (ceiling) / downward (floor) from the gap edge.
        const baseY = side * (gap * (0.35 + 0.65 * nearness));
        const span = diagonal * (0.35 + 0.75 * nearness);
        const left = -span / 2;
        const rise = ridgeHeight * (0.2 + 0.8 * nearness);

        const points = row.length * 2;
        const path = new Path2D();
        path.moveTo(left, baseY);
        for (let p = 0; p < points; p++) {
          const band = p < row.length ? row.length - 1 - p : p - row.length;
          const x = left + (span * (p + 0.5)) / points;
          path.lineTo(x, baseY + side * row[band] * rise);
        }
        path.lineTo(left + span, baseY);

        const fade = 0.1 + 0.9 * nearness;
        const fill = ctx.createLinearGradient(0, baseY, 0, baseY + side * rise);
        fill.addColorStop(0, '#000');
        fill.addColorStop(1, `hsl(${hue}, 100%, ${8 + 20 * fade}%)`);
        ctx.fillStyle = fill;
        ctx.fill(path);
        ctx.strokeStyle = `hsla(${hue}, 100%, ${45 + 30 * fade}%, ${fade})`;
        ctx.lineWidth = Math.max(1, height * 0.002 * (0.4 + 0.6 * nearness));
        ctx.lineJoin = 'round';
        ctx.stroke(path);
        // Front ridges get a soft glow pass (05 polish).
        if (r < 3) {
          ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${0.18 * fade})`;
          ctx.lineWidth = Math.max(3, height * 0.008 * nearness);
          ctx.stroke(path);
        }
      }
    }

    ctx.restore();
  }
}

export const fracturePreset: VisualizerPreset = {
  id: 'fracture',
  name: 'Fracture',
  create: () => new FractureRenderer(),
};
