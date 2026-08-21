/**
 * g18-advent — the section as a calendar: a 4x4 grid of numbered doors,
 * one per bar. The current door opens in four quantized quarter-steps
 * (one slat per beat); opened doors reveal an ornament remembering what
 * that bar SOUNDED like (centroid → hue, flatness → species, energy →
 * size). Section boundary slams every door shut in a cascade (luminance
 * down — flash-safe) and re-skins the calendar.
 */

import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

function mod(v: number, b: number): number {
  return ((v % b) + b) % b;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function trackSeed(frame: VisualizerFrameData): number {
  const chosen = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (chosen?.trackId != null) return chosen.trackId;
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (deck.trackId != null && deck.level > bestLevel) {
      best = deck.trackId;
      bestLevel = deck.level;
    }
  }
  return best ?? 1225;
}

interface Meter {
  tierBar: number;
  barPhase: number;
  beatInBar: number;
  beatsPerBar: number;
}

function meterOf(frame: VisualizerFrameData): Meter {
  const beat = frame.beat;
  if (beat) {
    return {
      tierBar: beat.ladderBarIndex ?? beat.barIndex,
      barPhase: clamp(beat.barPhase, 0, 0.999),
      beatInBar: beat.beatInBar,
      beatsPerBar: Math.max(1, beat.beatsPerBar),
    };
  }
  const t = frame.time / 2;
  const phase = mod(t, 1);
  return { tierBar: Math.floor(t), barPhase: phase, beatInBar: Math.floor(phase * 4), beatsPerBar: 4 };
}

/** What a completed bar sounded like: frozen ornament genome. */
interface Ornament {
  hue: number;
  species: 0 | 1 | 2; // rings (tonal) / gem (mixed) / starburst (noisy)
  size: number; // 0..1
}

class AdventRenderer implements PresetRenderer {
  private lastSection = Number.NEGATIVE_INFINITY;
  private lastBar = Number.NEGATIVE_INFINITY;
  private lastBeatKey = Number.NEGATIVE_INFINITY;
  private settle = 0; // slat-flip settle
  private ornaments: Array<Ornament | null> = new Array(16).fill(null);
  // Running accumulation for the CURRENT bar.
  private accCentroid = 0;
  private accFlatness = 0;
  private accEnergy = 0;
  private accTime = 0;
  private slam = 0; // section cascade (1 → 0)
  private pendingHue: number | null = null;
  private themeHue = 30;
  private kickEnv = 0;
  private rattle = 0;
  private rattlePhase = 0;

  private specFromAcc(): Ornament {
    const t = Math.max(1e-4, this.accTime);
    const centroid = this.accCentroid / t;
    const flatness = this.accFlatness / t;
    const energy = clamp(this.accEnergy / t, 0, 1);
    const species: 0 | 1 | 2 = flatness < 0.35 ? 0 : flatness < 0.62 ? 1 : 2;
    return {
      hue: mod(this.themeHue + 100 + (centroid - 0.5) * 220, 360),
      species,
      size: 0.35 + energy * 0.65,
    };
  }

  private drawOrnament(
    ctx: CanvasRenderingContext2D,
    spec: Ornament,
    cx: number,
    cy: number,
    cell: number,
    alpha: number,
    detail: number
  ): void {
    const r = cell * 0.3 * spec.size;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (spec.species === 0) {
      // Tonal: concentric rings.
      const rings = 2 + Math.round(detail * 2);
      for (let i = 1; i <= rings; i++) {
        ctx.strokeStyle = `hsl(${mod(spec.hue + i * 14, 360)}, 95%, ${52 + i * 4}%)`;
        ctx.lineWidth = Math.max(1.5, r * 0.12);
        ctx.beginPath();
        ctx.arc(cx, cy, (r * i) / rings, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (spec.species === 1) {
      // Mixed: faceted gem (hexagon, two tones + facet lines).
      ctx.fillStyle = `hsl(${spec.hue}, 90%, 50%)`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `hsl(${mod(spec.hue + 30, 360)}, 90%, 68%)`;
      ctx.lineWidth = Math.max(1, r * 0.08);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * r, cy - Math.sin(a) * r);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
    } else {
      // Noisy: starburst spikes.
      const spikes = 6 + Math.round(detail * 4);
      ctx.strokeStyle = `hsl(${spec.hue}, 95%, 62%)`;
      ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * Math.PI * 2;
        ctx.moveTo(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      ctx.stroke();
      ctx.fillStyle = `hsl(${mod(spec.hue + 40, 360)}, 90%, 70%)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = clamp(frame.dt, 0, 0.1);
    const meter = meterOf(frame);
    const barInSection = mod(meter.tierBar, 16);
    const section = Math.floor(meter.tierBar / 16);
    const seed = trackSeed(frame);
    const slow = frame.bandsSlow ?? frame.bands;
    const minDim = Math.min(width, height);

    // --- section cascade bookkeeping ---
    if (section !== this.lastSection) {
      const first = this.lastSection === Number.NEGATIVE_INFINITY;
      this.lastSection = section;
      const newHue = mod(seed * 71 + section * 37, 360);
      if (first) {
        this.themeHue = newHue;
      } else {
        this.slam = 1;
        this.pendingHue = newHue;
      }
    }
    if (this.slam > 0) {
      this.slam = Math.max(0, this.slam - dt / 0.45);
      if (this.slam === 0 && this.pendingHue != null) {
        this.themeHue = this.pendingHue;
        this.pendingHue = null;
        this.ornaments = new Array(16).fill(null);
      }
    }

    // --- bar completion: freeze the ornament genome ---
    if (meter.tierBar !== this.lastBar) {
      if (this.lastBar !== Number.NEGATIVE_INFINITY && this.accTime > 0) {
        const prevIdx = mod(this.lastBar, 16);
        // Only freeze if the previous bar belongs to the same displayed page.
        if (this.slam === 0 && Math.floor(this.lastBar / 16) === section) {
          this.ornaments[prevIdx] = this.specFromAcc();
        }
      }
      this.lastBar = meter.tierBar;
      this.accCentroid = 0;
      this.accFlatness = 0;
      this.accEnergy = 0;
      this.accTime = 0;
    }
    this.accCentroid += frame.centroid * dt;
    this.accFlatness += frame.flatness * dt;
    this.accEnergy += ((frame.bands.low + frame.bands.mid + frame.bands.high) / 2.2) * dt;
    this.accTime += dt;

    // --- beat snap ---
    const beatKey = meter.tierBar * 16 + meter.beatInBar;
    if (beatKey !== this.lastBeatKey) {
      this.lastBeatKey = beatKey;
      this.settle = 1;
    }
    this.settle = Math.max(0, this.settle - dt / 0.1);

    // --- impulse envelopes ---
    this.kickEnv = Math.max(this.kickEnv - dt / 0.15, clamp(frame.impulse.low, 0, 1) * 0.9);
    if (frame.impulse.mid > 0.55) this.rattle = 1;
    this.rattle = Math.max(0, this.rattle - dt / 0.15);
    this.rattlePhase += dt * 42;

    const hue = this.themeHue;
    const detail = frame.params.ornamentDetail ?? 0.6;
    const bevel = frame.params.bevel ?? 0.5;

    // --- background ---
    ctx.fillStyle = `hsl(${hue}, 34%, 4.5%)`;
    ctx.fillRect(0, 0, width, height);
    // Faint phrase rail on the left: 4 chips, one per row/phrase.
    for (let r = 0; r < 4; r++) {
      const active = Math.floor(barInSection / 4) === r;
      ctx.fillStyle = active
        ? `hsla(${mod(hue + 40, 360)}, 90%, 60%, 0.85)`
        : `hsla(${hue}, 40%, 35%, 0.3)`;
      ctx.fillRect(width * 0.045, height * (0.3 + r * 0.12), minDim * 0.012, height * 0.07);
    }

    // --- grid transform (kick pump = scale, never brightness) ---
    const side = Math.min(width * 0.6, height * 0.84);
    const pump = 1 + this.kickEnv * 0.02;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(pump, pump);
    ctx.translate(-side / 2, -side / 2);

    const gap = side * 0.025;
    const cell = (side - gap * 3) / 4;
    const slamP = 1 - this.slam; // 0 → 1 cascade progress

    for (let idx = 0; idx < 16; idx++) {
      const row = Math.floor(idx / 4);
      const col = idx % 4;
      let x = col * (cell + gap);
      const y = row * (cell + gap);
      const isCurrent = this.slam === 0 && idx === barInSection;

      // Snare rattle on the current door (contained deterministic jitter).
      if (isCurrent && this.rattle > 0) {
        x += Math.sin(this.rattlePhase) * this.rattle * this.rattle * cell * 0.02;
      }

      // Aperture in quantized quarter-slats: one slat per beat.
      let quarters: number;
      if (this.slam > 0) {
        // Cascade: door idx slams shut when the wave passes it.
        const wasOpen = idx < barInSection || this.ornaments[idx] != null;
        quarters = wasOpen && slamP < (idx + 1) / 16 ? 4 : 0;
      } else if (idx < barInSection) {
        quarters = 4;
      } else if (isCurrent) {
        quarters = meter.beatInBar + 1;
      } else {
        quarters = 0;
      }

      // Interior recess.
      ctx.fillStyle = `hsl(${hue}, 45%, 7%)`;
      ctx.fillRect(x, y, cell, cell);

      // Ornament (revealed by open slats via clip).
      const spec =
        this.ornaments[idx] ??
        (isCurrent && this.accTime > 0.05 ? this.specFromAcc() : null);
      if (spec && quarters > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell, (cell * Math.min(4, quarters)) / 4);
        ctx.clip();
        const frozen = this.ornaments[idx] != null;
        const shimmer = frozen ? 0.72 + slow.high * 0.22 : 0.95;
        this.drawOrnament(ctx, spec, x + cell / 2, y + cell / 2, cell, shimmer, detail);
        ctx.restore();
      }

      // Door slats: slat k covers quarter k; drawn if still closed.
      const doorFill = `hsl(${hue}, 55%, 17%)`;
      const doorEdge = `hsl(${mod(hue + 20, 360)}, 55%, ${10 + bevel * 14}%)`;
      for (let k = 0; k < 4; k++) {
        const slatY = y + (cell * k) / 4;
        const slatH = cell / 4;
        if (k < quarters - 1) continue; // fully open
        if (k === quarters - 1 && quarters <= 4) {
          // The slat opening RIGHT NOW: snap + settle shrink.
          const s = this.settle * this.settle;
          if (isCurrent && s > 0.01) {
            ctx.fillStyle = doorFill;
            ctx.fillRect(x, slatY, cell, slatH * s);
          }
          continue;
        }
        ctx.fillStyle = doorFill;
        ctx.fillRect(x, slatY, cell, slatH + 0.5);
        ctx.strokeStyle = doorEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, slatY + 0.5, cell - 1, slatH - 1);
      }

      // Door frame + number (closed/partial doors show their bar number).
      ctx.strokeStyle = isCurrent
        ? `hsla(${mod(hue + 40, 360)}, 95%, 62%, 0.95)`
        : `hsla(${hue}, 45%, 38%, 0.6)`;
      ctx.lineWidth = isCurrent ? 2.5 : 1.5;
      ctx.strokeRect(x, y, cell, cell);
      if (quarters < 4) {
        ctx.fillStyle = `hsla(${mod(hue + 25, 360)}, 65%, 46%, 0.85)`;
        ctx.font = `600 ${Math.round(cell * 0.3)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), x + cell / 2, y + cell * (quarters > 0 ? 0.62 : 0.52));
      }

      // Hinge glints on the current door (hats).
      if (isCurrent && frame.impulse.high > 0.3) {
        const g = clamp(frame.impulse.high, 0, 1);
        ctx.fillStyle = `hsla(${mod(hue + 60, 360)}, 90%, 78%, ${(g * 0.9).toFixed(3)})`;
        const dotR = Math.max(1.5, cell * 0.02);
        for (const [hx, hy] of [
          [x + cell * 0.06, y + cell * 0.08],
          [x + cell * 0.94, y + cell * 0.08],
        ] as Array<[number, number]>) {
          ctx.beginPath();
          ctx.arc(hx, hy, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore(); // pump
  }
}

const preset: VisualizerPreset = {
  id: 'g18-advent',
  name: 'g18 advent',
  params: [
    { id: 'bevel', label: 'door bevel', min: 0, max: 1, step: 0.05, default: 0.5 },
    { id: 'ornamentDetail', label: 'ornament detail', min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  create: () => new AdventRenderer(),
};

export default preset;
