/**
 * "Trigon" preset (realtime-visualization 02): a concentric triangle
 * tunnel after Vissonance's Tricentric — nested triangle rings, each
 * owned by a spectrum band, scaling and brightening with it; the whole
 * stack rotates faster as the track gets louder (their camera-roll ∝
 * loudness trick). One energy-swept hue with per-ring band shading keeps
 * the frame coherent.
 */

import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const RINGS = 16;

class TrigonRenderer implements PresetRenderer {
  private rotation = 0;

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
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);

    // Loudness-driven roll (Tricentric: rotation += f(avg loudness)).
    this.rotation += (0.12 + 2.4 * energy * energy) * frame.dt;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';

    // Outer rings first so inner (bass) rings draw on top.
    for (let i = RINGS - 1; i >= 0; i--) {
      const band = Math.floor((i / RINGS) * frame.spectrum.length);
      const level = frame.spectrum[band] ?? 0;
      // Bass innermost — the tunnel mouth pumps with the kick.
      const radius = unit * (0.05 + 0.026 * i) * (0.8 + 0.35 * level);
      const angle = this.rotation * (1 + i * 0.04) + i * 0.12;
      ctx.beginPath();
      for (let v = 0; v <= 3; v++) {
        const a = angle + (v / 3) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (v === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // Per-ring shade of the global hue (Tricentric shifts hue by band).
      ctx.strokeStyle = `hsla(${(hue - 50 * level + 360) % 360}, 100%, ${40 + 35 * level}%, ${
        0.18 + 0.82 * level
      })`;
      ctx.lineWidth = Math.max(1.5, unit * (0.002 + 0.01 * level));
      ctx.stroke();
    }

    // Core glow, bass-lit.
    const coreRadius = unit * (0.05 + 0.05 * frame.bands.low);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 2);
    glow.addColorStop(0, `hsla(${hue}, 100%, 65%, ${0.5 * frame.bands.low + 0.1})`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}

export const trigonPreset: VisualizerPreset = {
  id: 'trigon',
  name: 'Trigon',
  create: () => new TrigonRenderer(),
};
