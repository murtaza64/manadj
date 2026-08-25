/**
 * "Ladder" preset (realtime-visualization 05): the metric ladder made
 * visible — responses ESCALATE with the metric tier, so the music's
 * architecture (not just its beats) drives the scene:
 *
 *   beat            → a tick pulse on the inner ring
 *   bar downbeat    → ring burst
 *   4-bar phrase    → frame flash + palette hue jump + heavy burst
 *   16-bar section  → shockwave, spin DIRECTION flips, white bloom
 *
 * Four nested arcs sweep their tier phases (beat innermost, section
 * outermost) — you can watch the phrase filling up toward the next drop.
 * Tiers derive from the grid's absolute bar index (beat.ts barIndex),
 * anchored at the first downbeat; 4-bar phrases / 16-bar sections are the
 * four-on-the-floor assumption. Bands still live underneath: kicks pump
 * the center, energy scales brightness, gridless material falls back to
 * a bass-pulse heartbeat.
 */

import { energyHue, energyOf } from '../style';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const BURST_LIFE_S = 1.6;
/** Tier magnitudes: bar, phrase, section. */
const TIER_STRENGTH = [0.35, 0.7, 1];

interface Burst {
  age: number;
  tier: number; // 0 bar, 1 phrase, 2 section
  hue: number;
}

class LadderRenderer implements PresetRenderer {
  private bursts: Burst[] = [];
  private prevBar: number | null = null;
  private hueJump = 0;
  private spinDirection = 1;
  private rotation = 0;
  private flash = 0;
  private whiteBloom = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const { low, high } = frame.bands;
    const energy = energyOf(frame.bands);
    const beat = frame.beat;
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const hue = energyHue(energy, this.hueJump + (frame.centroid - 0.5) * 80);

    // Tier phases from the ladder-correct bar ordinal (respects Reset marks,
    // rt-viz 08) — falls back to the raw first-downbeat count when no ladder.
    const barIndex = beat ? beat.ladderBarIndex ?? beat.barIndex : null;
    const phrasePhase =
      beat && barIndex !== null ? ((((barIndex % 4) + 4) % 4) + beat.barPhase) / 4 : null;
    const sectionPhase =
      beat && barIndex !== null ? ((((barIndex % 16) + 16) % 16) + beat.barPhase) / 16 : null;

    // Rollover events, escalating by tier.
    if (beat && barIndex !== null) {
      if (this.prevBar !== null && barIndex !== this.prevBar) {
        const phraseRollover = ((barIndex % 4) + 4) % 4 === 0;
        const sectionRollover = ((barIndex % 16) + 16) % 16 === 0;
        const tier = sectionRollover ? 2 : phraseRollover ? 1 : 0;
        this.bursts.push({ age: 0, tier, hue });
        if (tier >= 1) {
          this.hueJump = (this.hueJump + 45 + 45 * tier) % 360;
          this.flash = TIER_STRENGTH[tier];
        }
        if (tier === 2) {
          this.spinDirection *= -1; // the section tell: the world reverses
          this.whiteBloom = 1;
        }
      }
      this.prevBar = barIndex;
    } else {
      this.prevBar = null;
    }
    this.flash = Math.max(0, this.flash - frame.dt * 1.8);
    this.whiteBloom = Math.max(0, this.whiteBloom - frame.dt * 1.2);
    this.rotation += this.spinDirection * frame.dt * (0.15 + 0.6 * energy);

    // Background: tier flash over a dark energy floor.
    ctx.fillStyle = `hsl(${hue}, 100%, ${2 + 5 * energy + 14 * this.flash}%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    if (this.whiteBloom > 0) {
      const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 0.8);
      bloom.addColorStop(0, `rgba(255,255,255,${0.35 * this.whiteBloom})`);
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, width, height);
    }

    // The ladder: nested tier arcs, beat innermost → section outermost.
    const tiers: {
      phase: number | null;
      radius: number;
      weight: number;
      subdivisions: number;
    }[] = [
      { phase: beat?.phase ?? null, radius: 0.16, weight: 1, subdivisions: 0 },
      { phase: beat?.barPhase ?? null, radius: 0.23, weight: 1.4, subdivisions: beat?.beatsPerBar ?? 4 },
      { phase: phrasePhase, radius: 0.3, weight: 2, subdivisions: 4 },
      { phase: sectionPhase, radius: 0.37, weight: 2.8, subdivisions: 16 },
    ];
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const r = unit * tier.radius * (1 + 0.05 * low * (i === 0 ? 1 : 0));
      // Track.
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${hue}, 100%, 50%, 0.12)`;
      ctx.lineWidth = Math.max(1, unit * 0.0022 * tier.weight);
      ctx.stroke();
      if (tier.phase === null) continue;
      // Subdivision ticks (bars on the phrase ring, bars-of-section on the
      // outer): the CURRENT subdivision is lit, so slow rings still move
      // at bar rate instead of reading as static.
      if (tier.subdivisions > 1) {
        const current = Math.min(
          tier.subdivisions - 1,
          Math.floor(tier.phase * tier.subdivisions)
        );
        for (let s = 0; s < tier.subdivisions; s++) {
          const a = -Math.PI / 2 + (s / tier.subdivisions) * Math.PI * 2;
          const lit = s === current;
          const inner = r - unit * (lit ? 0.014 : 0.006);
          const outer = r + unit * (lit ? 0.014 : 0.006);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
          ctx.strokeStyle = `hsla(${(hue + i * 18) % 360}, 100%, ${lit ? 78 : 45}%, ${
            lit ? 0.95 : 0.3
          })`;
          ctx.lineWidth = Math.max(1, unit * (lit ? 0.005 : 0.002));
          ctx.stroke();
        }
      }
      // Sweep: brightness surges hard over the last stretch before the
      // rollover — the "something is coming" glow.
      const x1 = Math.max(0, (tier.phase - 0.7) / 0.3);
      const anticipation = x1 * x1 * (3 - 2 * x1);
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + tier.phase * Math.PI * 2);
      ctx.strokeStyle = `hsla(${(hue + i * 18) % 360}, 100%, ${55 + 30 * anticipation}%, ${
        0.55 + 0.45 * anticipation
      })`;
      ctx.lineWidth = Math.max(1.5, unit * 0.004 * tier.weight * (1 + 0.8 * anticipation));
      ctx.stroke();
    }

    // Center: a rotating square pumping with the kick — the stable mass.
    const snap = beat ? Math.pow(1 - beat.phase, 3) : low * low;
    const radius = unit * (0.07 + 0.03 * snap + 0.04 * frame.impulse.low + 0.02 * low);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rotation);
    ctx.strokeStyle = `hsl(${hue}, 100%, ${52 + 35 * snap}%)`;
    ctx.lineWidth = Math.max(2, unit * 0.006);
    ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
    ctx.fillStyle = `hsla(${hue}, 100%, 55%, ${0.12 + 0.3 * snap})`;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();

    // Bursts: expanding rings, magnitude by tier.
    this.bursts = this.bursts.filter((burst) => {
      burst.age += frame.dt;
      const life = 1 - burst.age / BURST_LIFE_S;
      if (life <= 0) return false;
      const strength = TIER_STRENGTH[burst.tier];
      ctx.beginPath();
      ctx.arc(cx, cy, unit * (0.12 + burst.age * (0.3 + 0.35 * strength)), 0, Math.PI * 2);
      ctx.strokeStyle =
        burst.tier === 2
          ? `rgba(255,255,255,${life * 0.9})`
          : `hsla(${burst.hue}, 100%, 62%, ${life * (0.4 + 0.6 * strength)})`;
      ctx.lineWidth = Math.max(2, unit * 0.016 * strength * life);
      ctx.stroke();
      return true;
    });

    // High shimmer: sparkle dust on the outer track with the highs.
    if (high > 0.05) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = unit * 0.37 + (Math.random() - 0.5) * unit * 0.02;
        ctx.fillStyle = `hsla(${(hue + 40) % 360}, 100%, 75%, ${high * (0.3 + 0.5 * frame.impulse.high)})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(1, unit * 0.002), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}

export const ladderPreset: VisualizerPreset = {
  id: 'ladder',
  name: 'Ladder',
  create: () => new LadderRenderer(),
};
