/**
 * "Pulse" preset (realtime-visualization 02): beat-LOCKED visuals — the
 * one thing generic visualizers can't do. Geometry snaps to the dominant
 * audible deck's beatgrid (ADR 0016: the grid is authoritative), not to
 * inferred bass energy — and it counts the BAR, not just the beat:
 *
 *   - a ring launches on every beat; the DOWNBEAT ring is the big one
 *   - the background flash decays over each beat, strongest on the 1
 *   - the center polygon quarter-turns each beat, completing a full
 *     rotation per bar, and its vertex count = beatsPerBar
 *   - the outer arc sweeps the BAR with a tick per beat — you can watch
 *     the 4-count go by
 *
 * Without a grid (or while beatless), falls back to bass-edge triggering
 * so the preset never goes dark.
 */

import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const RING_SPEED_UNITS_PER_S = 0.55;
const RING_LIFE_S = 1.4;
const MAX_RINGS = 16;
/** Bass-edge fallback trigger (gridless tracks). */
const FALLBACK_THRESHOLD = 0.82;
/** How fast the polygon eases onto its per-beat rotation slot. */
const SNAP_RATE = 10;

interface Ring {
  age: number;
  hue: number;
  strength: number;
  /** Downbeat rings run bigger and slower-fading. */
  downbeat: boolean;
}

class PulseRenderer implements PresetRenderer {
  private rings: Ring[] = [];
  private prevPhase: number | null = null;
  private prevLow = 0;
  private rotation = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const { low, mid, high } = frame.bands;
    const beat = frame.beat;
    const energy = energyOf(frame.bands);
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const hue = energyHue(energy, frame.time * 8);

    // Beat-edge detection: phase wrap = a new beat. Fallback: rising bass
    // through the threshold.
    let onBeat = false;
    if (beat) {
      if (this.prevPhase !== null && beat.phase < this.prevPhase) onBeat = true;
      this.prevPhase = beat.phase;
    } else {
      this.prevPhase = null;
      if (this.prevLow < FALLBACK_THRESHOLD && low >= FALLBACK_THRESHOLD) onBeat = true;
    }
    this.prevLow = low;
    const isDownbeat = !!beat && beat.beatInBar === 0;
    if (onBeat && this.rings.length < MAX_RINGS) {
      this.rings.push({
        age: 0,
        hue: (hue + 40) % 360,
        strength: (isDownbeat ? 0.75 : 0.35) + 0.4 * low,
        downbeat: isDownbeat,
      });
    }

    // Background: a flash that decays over the beat, strongest on the 1.
    const flashWeight = beat ? (beat.beatInBar === 0 ? 1 : 0.55) : 1;
    const decay = (beat ? Math.pow(1 - beat.phase, 2) : low * low) * flashWeight;
    ctx.fillStyle = `hsl(${hue}, 100%, ${3 + 10 * decay}%)`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'lighter';

    // Beat rings — downbeat rings are the big hits.
    this.rings = this.rings.filter((ring) => {
      ring.age += frame.dt;
      if (ring.age >= RING_LIFE_S) return false;
      const life = 1 - ring.age / RING_LIFE_S;
      const size = ring.downbeat ? 1.35 : 1;
      const radius = unit * (0.12 + ring.age * RING_SPEED_UNITS_PER_S * size);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${ring.hue}, 100%, ${ring.downbeat ? 68 : 60}%, ${
        life * ring.strength
      })`;
      ctx.lineWidth = Math.max(2, unit * (ring.downbeat ? 0.02 : 0.01) * life);
      ctx.stroke();
      return true;
    });

    // Center polygon: sides = beatsPerBar; quarter-turns onto a new slot
    // each beat (full rotation per bar), pumping on the beat.
    const sides = beat?.beatsPerBar ?? 4;
    if (beat) {
      const target = (beat.beatInBar / sides) * Math.PI * 2;
      // Shortest-path ease onto the slot — the turn reads as a snap.
      let delta = target - (this.rotation % (Math.PI * 2));
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      this.rotation += delta * Math.min(1, frame.dt * SNAP_RATE);
    } else {
      this.rotation += frame.dt * 0.3;
    }
    const snap = beat ? Math.pow(1 - beat.phase, 3) * flashWeight : decay;
    const radius = unit * (0.1 + 0.08 * snap + 0.05 * low);
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const angle = -Math.PI / 2 + (i / sides) * Math.PI * 2 + this.rotation;
      const r = radius * (1 + 0.12 * mid * Math.sin(angle * 3 + frame.time * 5));
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsl(${hue}, 100%, ${50 + 40 * snap}%)`;
    ctx.lineWidth = Math.max(2, unit * 0.006);
    ctx.stroke();
    ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${0.15 + 0.35 * snap})`;
    ctx.fill();

    // Bar arc: sweeps the whole bar with a tick per beat — the "locked"
    // tell, now counting the 4. High energy brightens it.
    if (beat) {
      const arcRadius = radius * 1.6;
      const accent = (hue + 180) % 360;
      ctx.beginPath();
      ctx.arc(cx, cy, arcRadius, -Math.PI / 2, -Math.PI / 2 + beat.barPhase * Math.PI * 2);
      ctx.strokeStyle = `hsla(${accent}, 100%, ${60 + 30 * high}%, 0.9)`;
      ctx.lineWidth = Math.max(2, unit * 0.005);
      ctx.stroke();
      // Beat ticks around the bar circle; the current beat's tick is lit.
      for (let b = 0; b < beat.beatsPerBar; b++) {
        const angle = -Math.PI / 2 + (b / beat.beatsPerBar) * Math.PI * 2;
        const lit = b === beat.beatInBar;
        const inner = arcRadius - unit * (lit ? 0.02 : 0.012);
        const outer = arcRadius + unit * (lit ? 0.02 : 0.012);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.strokeStyle = lit
          ? `hsla(${accent}, 100%, 80%, 1)`
          : `hsla(${accent}, 100%, 60%, 0.45)`;
        ctx.lineWidth = Math.max(2, unit * (lit ? 0.006 : 0.003));
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}

export const pulsePreset: VisualizerPreset = {
  id: 'pulse',
  name: 'Pulse',
  create: () => new PulseRenderer(),
};
