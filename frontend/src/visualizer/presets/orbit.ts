/**
 * "Orbit" preset (realtime-visualization 05): the DECK-AWARE scene. Each
 * Master-audible deck is a glowing body in its identity color
 * (theme/deckColors.ts), sized by its audible level.
 *
 * Positioning is IDENTITY-STABLE (walkthrough feedback: rank-based
 * placement made bodies swap on a bass swap): every channel owns a fixed
 * orbital slot angle forever; dominance only pulls a body smoothly toward
 * the center (radius = f(level share)), so a bass swap reads as two
 * bodies gliding past each other, never teleporting.
 *
 * Background: each body casts ambient light into the room (soft radial
 * gradients at its position), and a field of dust motes drifts through,
 * tinted by the audibility mix and twinkling with the highs.
 *
 * Doubles (same track audible on two decks): synced beat rings from both
 * bodies. Transitions: a spark bridge between the top two, denser as the
 * blend evens.
 */

import { DECK_COLORS } from '../../theme/deckColors';
import type { DeckStateInfo } from '../channel';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

const TRAIL_ALPHA = 0.22;
const RING_LIFE_S = 1.1;
const MAX_SPARKS = 160;
const DUST_COUNT = 42;

/** Fixed orbital slot per channel — the identity anchor. */
const SLOT_ANGLE: Record<string, number> = {
  A: -Math.PI / 2,
  B: Math.PI / 2,
  C: 0,
  D: Math.PI,
};

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const DECK_RGB: Record<string, [number, number, number]> = Object.fromEntries(
  Object.entries(DECK_COLORS).map(([deck, hex]) => [deck, hexToRgb(hex)])
);

function rgba(rgb: [number, number, number], alpha: number, scale = 1): string {
  const c = (v: number) => Math.min(255, Math.round(v * scale));
  return `rgba(${c(rgb[0])}, ${c(rgb[1])}, ${c(rgb[2])}, ${alpha})`;
}

interface Ring {
  age: number;
  rgb: [number, number, number];
  x: number;
  y: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  rgb: [number, number, number];
}

interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  seed: number;
}

class OrbitRenderer implements PresetRenderer {
  private phase = 0;
  private rings: Ring[] = [];
  private sparks: Spark[] = [];
  private dust: Dust[] = [];
  private prevBeatPhase: number | null = null;
  private levels = new Map<string, number>();

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

    // Smooth deck levels; the cast keeps CHANNEL identity, no rank sort.
    const active: (DeckStateInfo & { smooth: number })[] = [];
    for (const deck of frame.decks) {
      const previous = this.levels.get(deck.channel) ?? 0;
      const tau = deck.level > previous ? 0.05 : 0.35;
      const alpha = 1 - Math.exp(-frame.dt / tau);
      const smooth = previous + (deck.level - previous) * alpha;
      this.levels.set(deck.channel, smooth);
      if (smooth > 0.02) active.push({ ...deck, smooth });
    }
    const total = active.reduce((sum, deck) => sum + deck.smooth, 0);
    // Top two BY LEVEL (for bridge/doubles only — never for placement).
    const ranked = [...active].sort((a, b) => b.smooth - a.smooth);

    // Trail wash tinted by the audibility mix.
    let bg: [number, number, number] = [4, 4, 8];
    for (const deck of active) {
      const w = (deck.smooth / Math.max(1e-4, total)) * 0.09;
      const rgb = DECK_RGB[deck.channel];
      bg = [bg[0] + rgb[0] * w, bg[1] + rgb[1] * w, bg[2] + rgb[2] * w];
    }
    const wash = frame.params.trails ?? TRAIL_ALPHA;
    ctx.fillStyle = `rgba(${Math.round(bg[0])}, ${Math.round(bg[1])}, ${Math.round(bg[2])}, ${wash})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    this.phase += frame.dt * (0.25 + 1.6 * mid + 0.6 * frame.trend.excitement);

    const blend =
      ranked.length >= 2
        ? Math.min(1, (ranked[1].smooth / Math.max(1e-4, ranked[0].smooth)) * 1.2)
        : 0;
    const doubles =
      ranked.length >= 2 &&
      ranked[0].trackId !== null &&
      ranked[0].trackId === ranked[1].trackId;

    // Identity-stable placement: fixed slot angle per channel; the level
    // SHARE pulls a body toward the center continuously.
    const positions = new Map<string, { x: number; y: number }>();
    for (const deck of active) {
      const share = deck.smooth / Math.max(1e-4, total);
      const reach = unit * (0.05 + 0.22 * (1 - share)) * (active.length === 1 ? 0 : 1);
      const angle = this.phase * 0.35 + SLOT_ANGLE[deck.channel];
      positions.set(deck.channel, {
        x: cx + Math.cos(angle) * reach,
        y: cy + Math.sin(angle) * reach * 0.72,
      });
    }

    // Ambient light: each body tints its neighborhood of the room.
    for (const deck of active) {
      const pos = positions.get(deck.channel)!;
      const rgb = DECK_RGB[deck.channel];
      const reach = unit * (0.5 + 0.3 * deck.smooth);
      const light = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, reach);
      light.addColorStop(0, rgba(rgb, 0.05 + 0.09 * deck.smooth));
      light.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, width, height);
    }

    // Dust motes: drifting through the room, tinted by the mix, brighter
    // and faster with the highs.
    if (this.dust.length === 0) {
      for (let i = 0; i < DUST_COUNT; i++) {
        this.dust.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * unit * 0.02,
          vy: (Math.random() - 0.5) * unit * 0.02,
          seed: Math.random() * Math.PI * 2,
        });
      }
    }
    for (const mote of this.dust) {
      mote.x += mote.vx * frame.dt * (1 + 2 * high);
      mote.y += mote.vy * frame.dt * (1 + 2 * high);
      if (mote.x < 0) mote.x += width;
      if (mote.x > width) mote.x -= width;
      if (mote.y < 0) mote.y += height;
      if (mote.y > height) mote.y -= height;
      const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(frame.time * 2.5 + mote.seed * 7));
      ctx.fillStyle = `rgba(${Math.round(bg[0] * 14)}, ${Math.round(bg[1] * 14)}, ${Math.round(
        bg[2] * 14
      )}, ${(0.1 + 0.35 * high) * twinkle})`;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, Math.max(1, unit * 0.0016 * (1 + high)), 0, Math.PI * 2);
      ctx.fill();
    }

    // Beat rings from the dominant body (both when doubles).
    if (frame.beat) {
      if (this.prevBeatPhase !== null && frame.beat.phase < this.prevBeatPhase && ranked.length > 0) {
        // dominant: smoothed frame.dominantChannel (layering jitter fix)
        const domBody =
          active.find((d) => d.channel === frame.dominantChannel) ?? ranked[0];
        const emitters = doubles ? [ranked[0], ranked[1]] : [domBody];
        for (const deck of emitters) {
          const pos = positions.get(deck.channel);
          if (!pos) continue;
          this.rings.push({ age: 0, rgb: DECK_RGB[deck.channel], x: pos.x, y: pos.y });
        }
      }
      this.prevBeatPhase = frame.beat.phase;
    } else {
      this.prevBeatPhase = null;
    }
    this.rings = this.rings.filter((ring) => {
      ring.age += frame.dt;
      if (ring.age >= RING_LIFE_S) return false;
      const life = 1 - ring.age / RING_LIFE_S;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, unit * (0.06 + ring.age * 0.4), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(ring.rgb, 0.5 * life, 1.2);
      ctx.lineWidth = Math.max(1.5, unit * 0.008 * life);
      ctx.stroke();
      return true;
    });

    // The bodies.
    for (const deck of active) {
      const pos = positions.get(deck.channel)!;
      const rgb = DECK_RGB[deck.channel];
      const radius =
        unit *
        (0.05 + 0.14 * deck.smooth) *
        (1 + 0.3 * low * deck.smooth + 0.5 * frame.impulse.low * deck.smooth);
      const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius * 2.6);
      glow.addColorStop(0, rgba(rgb, 0.95, 1.4));
      glow.addColorStop(0.35, rgba(rgb, 0.5 * deck.smooth + 0.2));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius * 2.6, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 3; k++) {
        const a = this.phase * 2.4 + (k / 3) * Math.PI * 2 + SLOT_ANGLE[deck.channel];
        const fx = pos.x + Math.cos(a) * radius * 1.5;
        const fy = pos.y + Math.sin(a) * radius * 1.5;
        ctx.fillStyle = rgba(rgb, 0.35 + 0.6 * mid, 1.3);
        ctx.beginPath();
        ctx.arc(fx, fy, Math.max(1.5, radius * 0.09 * (1 + mid)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Transition bridge between the top two.
    if (ranked.length >= 2) {
      const a = positions.get(ranked[0].channel);
      const b = positions.get(ranked[1].channel);
      if (a && b) {
        const wanted = (30 * blend + 140 * frame.impulse.high * blend) * frame.dt;
        let spawn = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
        while (spawn-- > 0 && this.sparks.length < MAX_SPARKS) {
          const t = Math.random();
          const mixRgb: [number, number, number] = [
            DECK_RGB[ranked[0].channel][0] * (1 - t) + DECK_RGB[ranked[1].channel][0] * t,
            DECK_RGB[ranked[0].channel][1] * (1 - t) + DECK_RGB[ranked[1].channel][1] * t,
            DECK_RGB[ranked[0].channel][2] * (1 - t) + DECK_RGB[ranked[1].channel][2] * t,
          ];
          this.sparks.push({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            vx: (Math.random() - 0.5) * unit * 0.12,
            vy: (Math.random() - 0.5) * unit * 0.12 - unit * 0.03,
            age: 0,
            rgb: mixRgb,
          });
        }
      }
    }
    this.sparks = this.sparks.filter((spark) => {
      spark.age += frame.dt;
      if (spark.age >= 0.6) return false;
      spark.x += spark.vx * frame.dt;
      spark.y += spark.vy * frame.dt;
      const life = 1 - spark.age / 0.6;
      ctx.fillStyle = rgba(spark.rgb, life, 1.2);
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, Math.max(1, unit * 0.0022 * (1 + life)), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.globalCompositeOperation = 'source-over';
  }
}

export const orbitPreset: VisualizerPreset = {
  id: 'orbit',
  name: 'Orbit',
  params: [
    { id: 'trails', label: 'trail wash (low = long)', min: 0.05, max: 0.4, step: 0.01, default: 0.22 },
  ],
  create: () => new OrbitRenderer(),
};
