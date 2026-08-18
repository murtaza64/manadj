/**
 * "Siphon" preset (realtime-visualization 02): inside a tube of spectrum
 * rings flying past the viewer — a canvas-2D port of Vissonance's Siphon.
 * Each ring is a snapshot of the spectrum wrapped into a closed radial
 * polygon; rings spawn deep in the tube and accelerate outward with the
 * energy (their `position += f(loudness)·loudness`). Two signature
 * Siphon moves kept: the INVERTED breathing — the whole tube contracts
 * as the track gets louder (`scale = 1 − loudness`) — and the background
 * tinted the COMPLEMENT of the trace hue (kept dark for the black stage).
 */

import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

/** New ring when the innermost has grown past this radius fraction. */
const SPAWN_AT = 0.09;
const START_RADIUS = 0.055;
/** Radial growth: rings accelerate outward with energy (loudness²·k). */
const MIN_GROW_PER_S = 0.25;
const MAX_GROW_PER_S = 2.4;
const MAX_RINGS = 22;

interface Ring {
  /** Radius as a fraction of the unit dimension. */
  radius: number;
  levels: number[];
  hue: number;
}

class SiphonRenderer implements PresetRenderer {
  private rings: Ring[] = [];

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const energy = energyOf(frame.bands);
    const hue = energyHue(energy);

    // Siphon's complementary background, darkened for the black stage.
    ctx.fillStyle = `hsl(${(hue + 180) % 360}, 100%, ${3 + 5 * energy}%)`;
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    // Inverted breathing: loud = the tube tightens around you.
    const unit = Math.min(width, height) * (1.15 - 0.45 * energy);

    // Grow rings outward; retire the ones that flew past.
    const growth = (MIN_GROW_PER_S + (MAX_GROW_PER_S - MIN_GROW_PER_S) * energy * energy)
      * frame.dt;
    for (const ring of this.rings) ring.radius *= 1 + growth * (1 + ring.radius * 2.2);
    this.rings = this.rings.filter((ring) => ring.radius < 1.6);

    // Spawn a fresh spectrum ring once the newest has cleared the mouth.
    const newest = this.rings[this.rings.length - 1];
    if ((!newest || newest.radius > SPAWN_AT) && this.rings.length < MAX_RINGS) {
      this.rings.push({
        radius: START_RADIUS,
        levels: frame.spectrum.slice(),
        hue,
      });
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    for (const ring of this.rings) {
      const points = ring.levels.length * 2;
      const base = ring.radius * unit;
      // Nearness: how far down the tube (0 deep → 1 at the viewer).
      const nearness = Math.min(1, ring.radius / 1.1);
      ctx.beginPath();
      for (let p = 0; p <= points; p++) {
        const i = p % points;
        const band = i < ring.levels.length ? i : points - 1 - i;
        const bulge = 1 + ring.levels[band] * 0.4;
        const angle = -Math.PI / 2 + (i / points) * Math.PI * 2;
        const r = base * bulge;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.82;
        if (p === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const alpha = nearness < 0.12 ? nearness / 0.12 : 1 - Math.max(0, (nearness - 0.75) / 0.25);
      ctx.strokeStyle = `hsla(${ring.hue}, 100%, ${40 + 35 * nearness}%, ${alpha})`;
      ctx.lineWidth = Math.max(1, unit * 0.0045 * (0.3 + nearness * 1.6));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

export const siphonPreset: VisualizerPreset = {
  id: 'siphon',
  name: 'Siphon',
  create: () => new SiphonRenderer(),
};
