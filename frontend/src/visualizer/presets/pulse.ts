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
    // Harmonic color (05): the spectral centroid swings the hue — dark
    // bass-heavy passages sit one side of the energy sweep, bright
    // harmonic material the other. Rings keep the hue of their spawn
    // moment, so a fill's palette trails through the scene.
    const harmonic = frame.params.harmonic ?? 0.6;
    const hue = energyHue(energy, frame.time * 8 + (frame.centroid - 0.5) * 160 * harmonic);
    // Section intensity (05): drops push it toward 1, breakdowns toward
    // the floor — the whole scene breathes with the track, not the frame.
    const intensity = 0.35 + 0.65 * frame.trend.excitement;

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
      // Ring punch rides the kick TRANSIENT, not the bass level — a beat
      // with an actual kick hits harder than a quantized silent beat.
      this.rings.push({
        age: 0,
        hue: (hue + 40) % 360,
        strength: ((isDownbeat ? 0.7 : 0.3) + 0.5 * frame.impulse.low + 0.2 * low) * intensity,
        downbeat: isDownbeat,
      });
    }

    // Background: a flash that decays over the beat, strongest on the 1.
    const flashWeight = beat ? (beat.beatInBar === 0 ? 1 : 0.55) : 1;
    const decay = (beat ? Math.pow(1 - beat.phase, 2) : low * low) * flashWeight;
    ctx.fillStyle = `hsl(${hue}, 100%, ${2 + 3 * frame.trend.slow + 9 * decay * intensity}%)`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'lighter';

    // Beat rings — downbeat rings are the big hits.
    this.rings = this.rings.filter((ring) => {
      ring.age += frame.dt;
      if (ring.age >= RING_LIFE_S) return false;
      const life = 1 - ring.age / RING_LIFE_S;
      const size = ring.downbeat ? 1.35 : 1;
      const speed = RING_SPEED_UNITS_PER_S * (0.6 + 0.8 * intensity) * (frame.params.ringSpeed ?? 1);
      const radius = unit * (0.12 + ring.age * speed * size);
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
      // Rotation character follows section intensity (walkthrough
      // feedback: quarter-turn snaps at low energy read as more hype than
      // the track): calm = smooth continuous spin, drops = crisp per-beat
      // snaps onto the bar slots.
      this.rotation += frame.dt * 0.25 * (1 - intensity);
      const target = (beat.beatInBar / sides) * Math.PI * 2;
      let delta = target - (this.rotation % (Math.PI * 2));
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      this.rotation += delta * Math.min(1, frame.dt * SNAP_RATE) * intensity;
    } else {
      this.rotation += frame.dt * 0.3;
    }
    const snap = beat ? Math.pow(1 - beat.phase, 3) * flashWeight : decay;
    // Pump depth follows intensity too: near-steady square in calm
    // sections, full per-beat breathing through a drop.
    const pump = snap * (0.2 + 0.8 * intensity) * (frame.params.pump ?? 1);
    const radius = unit * (0.1 + 0.07 * pump + 0.05 * low + 0.04 * frame.impulse.low);
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
    ctx.strokeStyle = `hsl(${hue}, 100%, ${50 + 40 * pump}%)`;
    ctx.lineWidth = Math.max(2, unit * 0.006);
    ctx.stroke();
    ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${0.15 + 0.35 * pump})`;
    ctx.fill();
    // Snare flash (05): mid transients blink a white edge — snares read
    // against sustained vocals/pads which barely move the impulse.
    if (frame.impulse.mid > 0.05) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.85 * frame.impulse.mid})`;
      ctx.lineWidth = Math.max(1.5, unit * 0.003 + unit * 0.006 * frame.impulse.mid);
      ctx.stroke();
    }

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
  params: [
    { id: 'harmonic', label: 'harmonic color', min: 0, max: 1.5, step: 0.05, default: 0.6 },
    { id: 'ringSpeed', label: 'ring speed', min: 0.4, max: 2, step: 0.05, default: 1 },
    { id: 'pump', label: 'pump depth', min: 0, max: 1.5, step: 0.05, default: 1 },
  ],
  create: () => new PulseRenderer(),
};
