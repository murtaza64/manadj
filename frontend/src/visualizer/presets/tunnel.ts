/**
 * "Tunnel" preset (realtime-visualization 02): Milkdrop-style warp
 * feedback — each frame is the previous frame zoomed and rotated (drawn
 * from an offscreen copy, never canvas-onto-itself), with fresh geometry
 * stamped on top. Bass drives the zoom rate (a kick lunges the tunnel
 * forward), mids drive rotation, highs spawn sparkles that get smeared
 * into streaks by the feedback. The canonical "interesting" visualizer
 * family (Milkdrop/projectM/butterchurn), reduced to canvas 2D.
 */

import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const SPARKS_PER_S = 160;
class TunnelRenderer implements PresetRenderer {
  private buffer: HTMLCanvasElement | null = null;
  private bufferCtx: CanvasRenderingContext2D | null = null;
  private rotation = 0;

  private ensureBuffer(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.buffer || this.buffer.width !== width || this.buffer.height !== height) {
      this.buffer = document.createElement('canvas');
      this.buffer.width = width;
      this.buffer.height = height;
      this.bufferCtx = this.buffer.getContext('2d');
    }
    return this.bufferCtx;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const bufferCtx = this.ensureBuffer(width, height);
    const { low, mid, high } = frame.bands;
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);

    // Warp the previous frame in: zoom toward the viewer (bass-driven)
    // with a mid-driven twist. Paint black first — the warp must composite
    // onto darkness so edges fall away.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    if (this.buffer && bufferCtx) {
      // Kick lunge (05): the transient, not the level, throws you forward.
      const zoomAmount = frame.params.zoom ?? 1;
      const zoom = 1 + (0.3 + 1.4 * low * low + 3.5 * frame.impulse.low) * zoomAmount * frame.dt;
      this.rotation = (0.1 + 1.2 * mid + 1.8 * frame.impulse.mid) * frame.dt;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.rotation);
      ctx.scale(zoom, zoom);
      ctx.globalAlpha = 0.9 + 0.095 * (frame.params.trail ?? 0.68);
      ctx.drawImage(this.buffer, -cx, -cy);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Fresh geometry: a wobbling ring at the tunnel mouth. The feedback
    // zoom smears successive rings into the tunnel walls.
    ctx.globalCompositeOperation = 'lighter';
    const hue = energyHue(energyOf(frame.bands), frame.time * 6);
    const radius = unit * (0.1 + 0.16 * low);
    const wobble = unit * 0.02 * mid;
    ctx.beginPath();
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = radius + Math.sin(angle * 6 + frame.time * 3) * wobble;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsl(${hue}, 100%, ${45 + 35 * low}%)`;
    ctx.lineWidth = Math.max(2, unit * (0.004 + 0.014 * low));
    ctx.stroke();

    // High-driven sparkles — the feedback stretches them into star-streaks.
    const wanted = SPARKS_PER_S * high * high * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0) {
      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.9 + Math.random() * 0.4);
      const size = unit * (0.0015 + 0.003 * Math.random());
      ctx.fillStyle = `hsl(${(hue + 180 + Math.random() * 40) % 360}, 100%, 75%)`;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(angle) * distance,
        cy + Math.sin(angle) * distance,
        size,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Snapshot this frame for the next warp.
    if (bufferCtx && this.buffer) {
      bufferCtx.clearRect(0, 0, width, height);
      bufferCtx.drawImage(ctx.canvas, 0, 0);
    }
  }
}

export const tunnelPreset: VisualizerPreset = {
  id: 'tunnel',
  name: 'Tunnel',
  params: [
    { id: 'trail', label: 'trail length', min: 0, max: 1, step: 0.02, default: 0.68 },
    { id: 'zoom', label: 'zoom drive', min: 0.3, max: 2.5, step: 0.05, default: 1 },
  ],
  create: () => new TunnelRenderer(),
};
