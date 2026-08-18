/**
 * "Bars" preset (realtime-visualization 01): classic segmented LED EQ
 * meters — three columns (LOW / MID / HIGH), green through yellow to red,
 * with a slow-falling peak-hold segment. Bright, fully saturated colors
 * (project convention — no pastels).
 */

import type { BandLevels } from '../bands';
import { BAND_RGB, cssRgb } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const SEGMENTS = 28;
/** Peak-cap kinematic gravity, column-fractions per second² (prior art:
 * Winamp/audioMotion caps free-fall rather than decay — audioMotion's
 * default ≈3.5 screen-heights/s²). */
const PEAK_GRAVITY = 3.2;
const PEAK_HOLD_S = 0.45;

const LABELS: { key: keyof BandLevels; label: string }[] = [
  { key: 'low', label: 'LOW' },
  { key: 'mid', label: 'MID' },
  { key: 'high', label: 'HIGH' },
];

function segmentColor(band: keyof BandLevels, fraction: number, lit: boolean): string {
  // Waveform band identity: low red, mid green, high blue — segments
  // brighten slightly toward the top of the column.
  const rgb = BAND_RGB[band];
  return lit ? cssRgb(rgb, 1, 0.8 + 0.5 * fraction) : cssRgb(rgb, 0.12);
}

class BarsRenderer implements PresetRenderer {
  private peaks: Record<keyof BandLevels, { value: number; heldFor: number; velocity: number }> = {
    low: { value: 0, heldFor: 0, velocity: 0 },
    mid: { value: 0, heldFor: 0, velocity: 0 },
    high: { value: 0, heldFor: 0, velocity: 0 },
  };

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const columnWidth = Math.min(width / 5, 220);
    const gap = columnWidth / 2;
    const totalWidth = LABELS.length * columnWidth + (LABELS.length - 1) * gap;
    const left = (width - totalWidth) / 2;
    const labelBand = Math.max(28, height * 0.06);
    const top = height * 0.08;
    const columnHeight = height - top - labelBand - height * 0.04;
    const segmentGap = Math.max(2, columnHeight / SEGMENTS / 4);
    const segmentHeight = (columnHeight - segmentGap * (SEGMENTS - 1)) / SEGMENTS;

    LABELS.forEach(({ key, label }, i) => {
      const level = frame.bands[key];
      const x = left + i * (columnWidth + gap);

      // Peak cap: instant rise, hold, then kinematic free-fall (v += g·dt).
      const peak = this.peaks[key];
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

      const litCount = Math.round(level * SEGMENTS);
      for (let s = 0; s < SEGMENTS; s++) {
        const fraction = (s + 0.5) / SEGMENTS;
        const y = top + columnHeight - (s + 1) * segmentHeight - s * segmentGap;
        ctx.fillStyle = segmentColor(key, fraction, s < litCount);
        ctx.fillRect(x, y, columnWidth, segmentHeight);
      }

      // Peak-hold marker: a bright white segment at the held level.
      if (peak.value > 0.005) {
        const peakSegment = Math.min(SEGMENTS - 1, Math.round(peak.value * SEGMENTS) - 1);
        if (peakSegment >= litCount) {
          const y =
            top + columnHeight - (peakSegment + 1) * segmentHeight - peakSegment * segmentGap;
          ctx.fillStyle = '#fff';
          ctx.fillRect(x, y, columnWidth, segmentHeight);
        }
      }

      ctx.fillStyle = cssRgb(BAND_RGB[key], 0.9);
      ctx.font = `bold ${Math.max(14, labelBand * 0.5)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + columnWidth / 2, top + columnHeight + labelBand * 0.7);
    });
  }
}

export const barsPreset: VisualizerPreset = {
  id: 'bars',
  name: 'Bars',
  create: () => new BarsRenderer(),
};
