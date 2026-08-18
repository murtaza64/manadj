/**
 * "Spectrum" preset (realtime-visualization 01): eight geometric-band bars
 * (40 Hz → 16 kHz) in the waveform's band colors — red bass through green
 * mids to blue treble (waveform/styles.ts ADDITIVE_COLORS) — with white gravity peak caps and cava's "monstercat" spatial
 * spread so a hit reads as a shape instead of an isolated spike. Prior art:
 * docs/research/audio-visualizer-prior-art.md.
 */

import { maxGroup, monstercatSpread } from '../bands';
import { bandRampRgb, cssRgb } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

/** The wire ships 24 fine bands; this preset stays the 8-bar classic —
 * geometric edges compose, so max-grouping triples is exact banding. */
const GROUP_SIZE = 3;

/** Kinematic cap fall, bar-height-fractions per second². */
const PEAK_GRAVITY = 3.6;
const PEAK_HOLD_S = 0.5;
/** Monstercat spread factor (1.5–2; larger = tighter spread). */
const SPREAD_FACTOR = 1.8;

interface PeakCap {
  value: number;
  heldFor: number;
  velocity: number;
}

class SpectrumRenderer implements PresetRenderer {
  private peaks: PeakCap[] = [];

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const levels = monstercatSpread(maxGroup(frame.spectrum, GROUP_SIZE), SPREAD_FACTOR);
    const count = levels.length;
    if (count === 0) return;
    while (this.peaks.length < count) {
      this.peaks.push({ value: 0, heldFor: 0, velocity: 0 });
    }

    const margin = width * 0.06;
    const span = width - margin * 2;
    const gap = span / count / 6;
    const barWidth = (span - gap * (count - 1)) / count;
    const baseY = height * 0.92;
    const maxBarHeight = height * 0.8;
    const capThickness = Math.max(3, height * 0.006);

    for (let i = 0; i < count; i++) {
      const level = levels[i];
      const x = margin + i * (barWidth + gap);
      const barHeight = level * maxBarHeight;
      const rgb = bandRampRgb(i / (count - 1));

      // Bar body: saturated vertical gradient, brighter toward the tip.
      if (barHeight > 0.5) {
        const gradient = ctx.createLinearGradient(0, baseY, 0, baseY - barHeight);
        gradient.addColorStop(0, cssRgb(rgb, 1, 0.55));
        gradient.addColorStop(1, cssRgb(rgb, 1, 0.9 + 0.5 * level));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, baseY - barHeight, barWidth, barHeight);
        // Hot tip line — reads as the bar "hitting".
        ctx.fillStyle = cssRgb(rgb, 0.4 + 0.6 * level, 1.6);
        ctx.fillRect(x, baseY - barHeight, barWidth, Math.min(barHeight, capThickness));
      }

      // Peak cap: instant rise, hold, kinematic free-fall (Winamp style).
      const peak = this.peaks[i];
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
      if (peak.value > 0.004) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, baseY - peak.value * maxBarHeight - capThickness, barWidth, capThickness);
      }
    }

    // Baseline.
    ctx.fillStyle = 'hsla(0, 0%, 100%, 0.25)';
    ctx.fillRect(margin, baseY, span, Math.max(1, height * 0.002));
  }
}

export const spectrumPreset: VisualizerPreset = {
  id: 'spectrum',
  name: 'Spectrum',
  create: () => new SpectrumRenderer(),
};
