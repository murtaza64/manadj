/**
 * "LED" preset (realtime-visualization 02): a classic LED wall — 24
 * columns × 16 rows of discrete cells in the waveform band ramp (red bass
 * → green mids → blue treble), unlit cells glowing faintly so the matrix reads as hardware.
 * White gravity peak cells (Winamp caps, quantized to the grid).
 */

import { bandRampRgb, cssRgb } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const ROWS = 16;
const PEAK_GRAVITY = 3.2;
const PEAK_HOLD_S = 0.45;

interface PeakCap {
  value: number;
  heldFor: number;
  velocity: number;
}

function cellColor(rgb: readonly [number, number, number], rowFraction: number, lit: boolean): string {
  // Column color = the band's ramp identity; cells brighten toward the top.
  return lit ? cssRgb(rgb, 1, 0.75 + 0.55 * rowFraction) : cssRgb(rgb, 0.09);
}

class LedRenderer implements PresetRenderer {
  private peaks: PeakCap[] = [];

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const levels = frame.spectrum;
    const columns = levels.length;
    if (columns === 0) return;
    while (this.peaks.length < columns) this.peaks.push({ value: 0, heldFor: 0, velocity: 0 });

    const margin = Math.min(width, height) * 0.05;
    const gridWidth = width - margin * 2;
    const gridHeight = height - margin * 2;
    const gapX = gridWidth / columns / 8;
    const gapY = gridHeight / ROWS / 5;
    const cellWidth = (gridWidth - gapX * (columns - 1)) / columns;
    const cellHeight = (gridHeight - gapY * (ROWS - 1)) / ROWS;

    for (let c = 0; c < columns; c++) {
      const level = levels[c];
      const lit = Math.round(level * ROWS);
      const rgb = bandRampRgb(c / (columns - 1));
      const x = margin + c * (cellWidth + gapX);

      const peak = this.peaks[c];
      if (level >= peak.value) {
        peak.value = level;
        peak.heldFor = 0;
        peak.velocity = 0;
      } else {
        peak.heldFor += frame.dt;
        if (peak.heldFor > PEAK_HOLD_S) {
          peak.velocity += PEAK_GRAVITY * frame.dt;
          peak.value = Math.max(level, peak.value - peak.velocity * frame.dt);
        }
      }
      const peakRow = Math.min(ROWS - 1, Math.round(peak.value * ROWS) - 1);

      for (let r = 0; r < ROWS; r++) {
        const y = margin + gridHeight - (r + 1) * cellHeight - r * gapY;
        if (r === peakRow && peakRow >= lit && peak.value > 0.01) {
          ctx.fillStyle = '#fff';
        } else {
          ctx.fillStyle = cellColor(rgb, (r + 0.5) / ROWS, r < lit);
        }
        ctx.fillRect(x, y, cellWidth, cellHeight);
      }
    }
  }
}

export const ledPreset: VisualizerPreset = {
  id: 'led',
  name: 'LED',
  create: () => new LedRenderer(),
};
