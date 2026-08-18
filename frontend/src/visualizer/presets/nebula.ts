/**
 * "Nebula" preset (realtime-visualization 01): an additive radial scene in
 * the waveform's band colors (low red core, mid green orbit, high blue
 * sparks — waveform/styles.ts ADDITIVE_COLORS). Each band owns a visual element, so an EQ
 * kill on the mixer visibly collapses exactly one layer:
 *
 *   low  → the core: a pulsing radial bloom whose radius and brightness
 *          ride the bass (a kick physically hits the screen)
 *   mid  → the orbit: satellites circling the core; mids drive their size,
 *          orbital speed, and reach
 *   high → the sparks: short-lived glints spawned across the field at a
 *          rate driven by high-frequency energy
 *
 * Trails come from a translucent black wash instead of a full clear;
 * everything else composites with 'lighter' so overlapping color adds up
 * to white-hot rather than muddying.
 */

import { BAND_RGB, cssRgb } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const ORBITERS = 7;
const MAX_SPARKS = 220;
const SPARK_LIFE_S = 0.45;
/** Sparks per second at high = 1. */
const SPARK_RATE = 240;
/** Slow global hue drift, degrees per second. */
const HUE_DRIFT_DEG_PER_S = 8;

interface Spark {
  x: number;
  y: number;
  age: number;
  size: number;
  hue: number;
}

class NebulaRenderer implements PresetRenderer {
  private sparks: Spark[] = [];
  private orbitPhase = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const { low, mid, high } = frame.bands;
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const baseHue = (frame.time * HUE_DRIFT_DEG_PER_S) % 360;

    // Trail wash: heavier when quiet so silence fades to black fast.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0, 0, 0, ${0.28 - 0.14 * Math.max(low, mid)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    // --- Low: the core bloom.
    const coreRadius = unit * (0.06 + 0.28 * low * low + 0.05 * low + 0.09 * frame.impulse.low);
    if (coreRadius > 1) {
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
      core.addColorStop(0, cssRgb(BAND_RGB.low, 0.55 + 0.45 * low, 1 + 0.8 * low));
      core.addColorStop(0.55, cssRgb(BAND_RGB.low, 0.35 * low));
      core.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Mid: the orbiters.
    this.orbitPhase += frame.dt * (0.4 + 2.2 * mid);
    const orbitReach = unit * (0.16 + 0.26 * mid);
    const orbSize = unit * (0.008 + 0.03 * mid);
    for (let i = 0; i < ORBITERS; i++) {
      const angle = this.orbitPhase + (i / ORBITERS) * Math.PI * 2;
      // Slightly eccentric orbits so the ring breathes instead of ticking.
      const reach = orbitReach * (1 + 0.15 * Math.sin(frame.time * 1.3 + i * 2.1));
      const x = cx + Math.cos(angle) * reach;
      const y = cy + Math.sin(angle) * reach * 0.72;
      const orb = ctx.createRadialGradient(x, y, 0, x, y, orbSize * 3);
      orb.addColorStop(0, cssRgb(BAND_RGB.mid, 0.25 + 0.75 * mid, 0.9 + 0.4 * mid));
      orb.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(x, y, orbSize * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- High: the sparks.
    const wanted = SPARK_RATE * (high * high + 2.5 * frame.impulse.high) * frame.dt;
    let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    while (spawn-- > 0 && this.sparks.length < MAX_SPARKS) {
      const angle = Math.random() * Math.PI * 2;
      const distance = unit * (0.1 + 0.42 * Math.random());
      this.sparks.push({
        x: cx + Math.cos(angle) * distance,
        y: cy + Math.sin(angle) * distance * 0.8,
        age: 0,
        size: unit * (0.002 + 0.004 * Math.random()),
        hue: (baseHue + 180 + Math.random() * 60) % 360,
      });
    }
    this.sparks = this.sparks.filter((spark) => {
      spark.age += frame.dt;
      if (spark.age >= SPARK_LIFE_S) return false;
      const life = 1 - spark.age / SPARK_LIFE_S;
      ctx.fillStyle = cssRgb(BAND_RGB.high, life, 1 + life);
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * (1 + 2 * life), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.globalCompositeOperation = 'source-over';
  }
}

export const nebulaPreset: VisualizerPreset = {
  id: 'nebula',
  name: 'Nebula',
  create: () => new NebulaRenderer(),
};
