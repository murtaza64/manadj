/**
 * "Radial" preset (realtime-visualization 02): the spectrum wrapped around
 * a breathing iris — 24 bands mirrored into 48 spokes, each fading
 * outward from a bass-lit hub. Style after Vissonance's Iris
 * (docs/research/audio-visualizer-prior-art.md): one loudness-swept hue
 * colors the whole wheel (deep blue quiet → magenta/red loud), the hub
 * radius breathes with energy, and spin speed rides the mids.
 */

import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const BASE_SPIN_RAD_PER_S = 0.1;
const MID_SPIN_RAD_PER_S = 1.1;

class RadialRenderer implements PresetRenderer {
  private rotation = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const { low, mid } = frame.bands;
    const energy = energyOf(frame.bands);
    const hue = energyHue(energy);
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    this.rotation += (BASE_SPIN_RAD_PER_S + MID_SPIN_RAD_PER_S * mid) * frame.dt;

    const bands = frame.spectrum;
    const spokes = bands.length * 2;
    const hubRadius = unit * (0.1 + 0.06 * energy + 0.035 * low + 0.05 * frame.impulse.low);
    const maxLength = unit * 0.32;
    const spokeWidth = ((Math.PI * 2) / spokes) * 0.7;

    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < spokes; s++) {
      const band = s < bands.length ? s : spokes - 1 - s;
      const level = bands[band];
      if (level <= 0.004) continue;
      const angle = this.rotation - Math.PI / 2 + (s / spokes) * Math.PI * 2;
      const length = level * maxLength;
      const tip = hubRadius + length;
      // Iris look: bright at the hub, dissolving outward (their shader's
      // depth-based fade, done as a per-spoke radial gradient).
      const gradient = ctx.createRadialGradient(cx, cy, hubRadius, cx, cy, tip);
      gradient.addColorStop(0, `hsla(${hue}, 100%, ${55 + 25 * level}%, 0.95)`);
      gradient.addColorStop(0.7, `hsla(${hue}, 100%, 50%, ${0.45 * level + 0.2})`);
      gradient.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, tip, angle - spokeWidth / 2, angle + spokeWidth / 2);
      ctx.arc(cx, cy, hubRadius, angle + spokeWidth / 2, angle - spokeWidth / 2, true);
      ctx.closePath();
      ctx.fill();
    }

    // Hub ring: the iris rim, breathing with the bass.
    ctx.beginPath();
    ctx.arc(cx, cy, hubRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${hue}, 100%, ${55 + 35 * low}%, ${0.6 + 0.4 * low})`;
    ctx.lineWidth = Math.max(2, unit * 0.004 + unit * 0.012 * low);
    ctx.stroke();
    // Inner glow.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, hubRadius);
    glow.addColorStop(0, `hsla(${hue}, 100%, 60%, ${0.25 * energy})`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, hubRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}

export const radialPreset: VisualizerPreset = {
  id: 'radial',
  name: 'Radial',
  create: () => new RadialRenderer(),
};
