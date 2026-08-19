/**
 * "Quad" preset (realtime-visualization 05, v2): four copies of Pulse,
 * one per channel in a fixed quadrant, each running entirely on ITS OWN
 * deck — no UI furniture, state speaks through effects and color:
 *
 *   - tile color = deck identity color; brightness = audible level
 *     (playing-but-inaudible decks animate dimmed — the beatmatch check:
 *     matched decks pulse in lockstep, drifting decks phase apart)
 *   - background flash + beat rings on the deck's own grid (downbeat
 *     rings ride bigger); polygon sides = its bar meter, quarter-turning
 *     per beat
 *   - EQ state AS effects: the low knob drives flash depth and ring
 *     weight, the mid knob drives polygon wobble, the high knob drives
 *     sparkle rate — kill a band on the mixer and that element dies in
 *     the tile
 */

import { DECK_COLORS } from '../../theme/deckColors';
import { CHANNEL_IDS } from '../../playback/mixer';
import type { DeckStateInfo } from '../channel';
import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from './types';

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const DECK_RGB: Record<string, [number, number, number]> = Object.fromEntries(
  Object.entries(DECK_COLORS).map(([deck, hex]) => [deck, hexToRgb(hex)])
);

function rgba(rgb: [number, number, number], alpha: number, scale = 1): string {
  const c = (v: number) => Math.min(255, Math.round(v * scale));
  return `rgba(${c(rgb[0])}, ${c(rgb[1])}, ${c(rgb[2])}, ${Math.max(0, Math.min(1, alpha))})`;
}

interface Ring {
  age: number;
  downbeat: boolean;
}

interface Spark {
  x: number;
  y: number;
  age: number;
}

interface TileState {
  rings: Ring[];
  sparks: Spark[];
  rotation: number;
  prevPhase: number | null;
}

const RING_LIFE_S = 0.9;

class QuadRenderer implements PresetRenderer {
  private tiles = new Map<string, TileState>();

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const decks = new Map(frame.decks.map((d) => [d.channel, d]));
    const tileW = width / 2;
    const tileH = height / 2;
    CHANNEL_IDS.forEach((channel, i) => {
      const x = (i % 2) * tileW;
      const y = Math.floor(i / 2) * tileH;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, tileW, tileH);
      ctx.clip();
      this.tile(ctx, x, y, tileW, tileH, channel, decks.get(channel) ?? null, frame);
      ctx.restore();
    });
  }

  private tile(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    channel: string,
    deck: DeckStateInfo | null,
    frame: VisualizerFrameData
  ): void {
    let state = this.tiles.get(channel);
    if (!state) {
      state = { rings: [], sparks: [], rotation: 0, prevPhase: null };
      this.tiles.set(channel, state);
    }
    const rgb = DECK_RGB[channel];
    const cx = x + w / 2;
    const cy = y + h / 2;
    const unit = Math.min(w, h);
    const playing = !!deck?.playing;
    const level = deck?.level ?? 0;
    const vis = playing ? 0.3 + 0.7 * level : 0.06;
    const phase = deck?.beatPhase ?? null;
    const snap = phase !== null ? Math.pow(1 - phase, 3) : 0;
    const eq = deck?.eq ?? { low: 0.5, mid: 0.5, high: 0.5 };

    // Background flash: the deck's own beat, depth from ITS low knob.
    const flash = snap * eq.low * 2 * vis;
    ctx.fillStyle = rgba(rgb, 0.04 + 0.12 * flash);
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = 'lighter';

    if (deck && playing && phase !== null) {
      // Beat edge → ring (downbeat bigger), weight from the low knob.
      if (state.prevPhase !== null && phase < state.prevPhase) {
        state.rings.push({ age: 0, downbeat: deck.beatInBar === 0 });
      }
      state.prevPhase = phase;
    } else {
      state.prevPhase = null;
    }
    state.rings = state.rings.filter((ring) => {
      ring.age += frame.dt;
      if (ring.age >= RING_LIFE_S) return false;
      const life = 1 - ring.age / RING_LIFE_S;
      const size = ring.downbeat ? 1.4 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, unit * (0.1 + ring.age * 0.42 * size), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(rgb, life * vis * (0.3 + 0.7 * eq.low), 1.2);
      ctx.lineWidth = Math.max(1.5, unit * (ring.downbeat ? 0.014 : 0.007) * life * (0.3 + eq.low));
      ctx.stroke();
      return true;
    });

    // Polygon: sides = bar meter, quarter-turning per beat; wobble from
    // the MID knob.
    const sides = deck?.beatsPerBar || 4;
    if (deck && deck.beatInBar !== null) {
      const target = (deck.beatInBar / sides) * Math.PI * 2;
      let delta = target - (state.rotation % (Math.PI * 2));
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      state.rotation += delta * Math.min(1, frame.dt * 8);
    } else {
      state.rotation += frame.dt * 0.25;
    }
    const radius = unit * (0.12 + 0.07 * snap * level + 0.03 * frame.impulse.low * level);
    ctx.beginPath();
    for (let v = 0; v <= sides; v++) {
      const a = -Math.PI / 2 + (v / sides) * Math.PI * 2 + state.rotation;
      const wobble = 1 + 0.16 * (eq.mid - 0.5) * 2 * Math.sin(a * 3 + frame.time * 5);
      const px = cx + Math.cos(a) * radius * wobble;
      const py = cy + Math.sin(a) * radius * wobble;
      if (v === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(rgb, Math.max(0.12, vis), 1.2);
    ctx.lineWidth = Math.max(1.5, unit * 0.008);
    ctx.stroke();
    ctx.fillStyle = rgba(rgb, vis * (0.12 + 0.35 * snap));
    ctx.fill();

    // Sparkles: rate from the HIGH knob × global high transients.
    if (deck && playing) {
      const wanted = 40 * eq.high * frame.impulse.high * (0.3 + level) * frame.dt * 60;
      let spawn = Math.floor(wanted * frame.dt) + (Math.random() < (wanted * frame.dt) % 1 ? 1 : 0);
      while (spawn-- > 0 && state.sparks.length < 50) {
        const a = Math.random() * Math.PI * 2;
        const d = radius * (1.3 + Math.random() * 1.6);
        state.sparks.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, age: 0 });
      }
    }
    state.sparks = state.sparks.filter((spark) => {
      spark.age += frame.dt;
      if (spark.age >= 0.4) return false;
      const life = 1 - spark.age / 0.4;
      ctx.fillStyle = rgba(rgb, life * vis, 1.6);
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, Math.max(1, unit * 0.003 * life), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.globalCompositeOperation = 'source-over';
  }
}

export const quadPreset: VisualizerPreset = {
  id: 'quad',
  name: 'Quad',
  create: () => new QuadRenderer(),
};
