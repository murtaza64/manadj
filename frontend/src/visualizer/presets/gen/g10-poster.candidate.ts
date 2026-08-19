/**
 * "g10 poster" (genetic arena g10, FLAT wave, NOVEL; Swiss/Bauhaus poster +
 * Memphis motion graphics). Human ask: flat color schemes, less noisy;
 * effects welcome.
 *
 * A bold flat POSTER that dances: a handful of LARGE solid geometric actors
 * (circle, bar, triangle, zigzag, arc) on a flat field, arranged by a
 * trackId-genome layout. No glow/haze/particles — solid matte fills, hard
 * edges, a committed 3-5 color scheme. Motion is TRANSFORMS (scale/translate/
 * rotate/flip) and COLOR SWAPS, cleanly eased or hard-cut on the grid. No
 * feedback buffer.
 *
 * FLAT LAW: every actor paints one matte fill from the scheme; the field is a
 * dark-but-not-void flat color. Effects (pops, swaps, recompositions, palette
 * swaps, drop maximalism) are welcome — the target is LESS NOISY than the
 * glowy winners, not static.
 *
 * The grammar:
 *   - LOWS = the big circle's scale BREATHING (rides bandsSlow.low — motion
 *     smoothness law, never jerks on a transient).
 *   - MIDS = bar/zigzag skew + travel (rides bandsSlow.mid).
 *   - HIGHS = small accent dots' COUNT (discrete, grid-placed, max 12 — NOT
 *     particles; a step function of bandsSlow.high).
 *   - KICK = one actor does a hard transform POP (scale 1.15x snap + settle),
 *     rotating WHICH actor per beat (gated on impulse.low, not kick-powder).
 *   - SNARE = two actors SWAP colors (instant, chroma-only).
 *   - BAR = layout micro-shift (quantized).
 *   - PHRASE (4 bars) = full layout RECOMPOSITION (hard cut, genome-sequenced).
 *   - SECTION (16 bars) = PALETTE swap across committed flat schemes.
 *   - DROP = poster goes MAXIMAL: actors enlarge, background flips to the
 *     loudest scheme color, composition pulses in beat-locked steps riding
 *     max(drop, energy). BUILDUP = actors crowd toward center (tension).
 *
 * Genome: the dominant audible deck's trackId seeds the actor set, the layout
 * sequence, and the starting scheme — same song, same poster. No trackId =>
 * frozen pseudo-seed.
 *
 * Anti-resemblance: NOT a particle field or fluid; discrete rigid actors,
 * hard edges, flat fills. Canvas 2D, source-over throughout.
 *
 * Assigned tech: bandsSlow (circle breathe / bar travel / dot count),
 * impulses (kick pop / snare swap), ladder tiers bar/phrase/section
 * (beat.ladderBarIndex ?? barIndex), trend (drop maximal / buildup crowd),
 * trackId genome (actor set + layout sequence).
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const PHRASE_BARS = 4;
const SECTION_BARS = 16;
const MAX_DOTS = 12;
const DROP_PULSE_HZ = 2; // photosafe beat-locked composition pulse ceiling

type ActorKind = 'circle' | 'bar' | 'triangle' | 'zigzag' | 'arc';
const ACTOR_KINDS: ActorKind[] = ['circle', 'bar', 'triangle', 'zigzag', 'arc'];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** splitmix32-style avalanche → stable [0,1). Same key ⇒ same poster. */
function splitmix(key: number): () => number {
  let state = (Math.round(key) >>> 0) + 0x9e3779b9;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    z = (z ^ (z >>> 15)) >>> 0;
    return z / 4294967296;
  };
}

function dominantTrackId(frame: VisualizerFrameData): number | null {
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (!deck.playing || deck.trackId == null) continue;
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      best = deck.trackId;
    }
  }
  return best;
}

/** Committed flat schemes: [bg, ...colors]. Bright, saturated (no pastels). */
const SCHEMES: string[][] = [
  // mustard / brick / cream / navy
  ['#141826', '#e8a319', '#c8402a', '#f2e6cf', '#1f3b6e'],
  // pink / red / white / black
  ['#0d0d0d', '#ff3d7f', '#e01e37', '#f5f5f5', '#111111'],
  // teal / orange / sand / charcoal
  ['#0f1a1c', '#12a89b', '#f0741f', '#e4c98a', '#242426'],
  // magenta / lime / cyan / violet
  ['#160b1f', '#e01fa0', '#8fd400', '#12b7d4', '#5a1fbf'],
];

/** Which scheme color is "loudest" (index into colors, i.e. SCHEME[1+..]) —
 * the drop flips the background to this. Chosen per scheme for boldness. */
const SCHEME_LOUD_INDEX = [1, 2, 1, 0]; // 0-based into colors[]

interface Actor {
  kind: ActorKind;
  // home layout (fractions of the field), recomposed per phrase.
  hx: number;
  hy: number;
  size: number; // fraction of unit
  colorIndex: number; // index into current scheme colors[]
  rot: number; // base rotation (radians)
}

interface Genome {
  actorCount: number; // 3..6
  kinds: ActorKind[]; // seeded actor set
  schemeStart: number;
  layoutSeq: number[]; // per-phrase layout selector
  colorSeq: number[]; // per-actor base color assignment
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const actorCount = 3 + Math.floor(r() * 4); // 3..6
  const kinds: ActorKind[] = [];
  for (let i = 0; i < actorCount; i++) {
    kinds.push(ACTOR_KINDS[Math.floor(r() * ACTOR_KINDS.length)]);
  }
  const layoutSeq = [0, 1, 2, 3].map(() => Math.floor(r() * 5));
  const colorSeq = kinds.map(() => 1 + Math.floor(r() * 4)); // never bg
  return {
    actorCount,
    kinds,
    schemeStart: Math.floor(r() * SCHEMES.length),
    layoutSeq,
    colorSeq,
  };
}

/** Layout presets: place N actors in a bold Swiss composition. Returns
 * [x,y,size] fractions per actor for a given layout id + count. */
function layoutFor(layoutId: number, i: number, count: number): [number, number, number] {
  const r = splitmix(layoutId * 131 + i * 17 + count * 7);
  const spread = 0.32;
  switch (mod(layoutId, 5)) {
    case 0: {
      // diagonal cascade
      const t = count > 1 ? i / (count - 1) : 0.5;
      return [lerp(0.22, 0.78, t), lerp(0.24, 0.76, t), 0.12 + 0.1 * (1 - t)];
    }
    case 1: {
      // ring around center
      const a = (i / count) * Math.PI * 2;
      return [0.5 + Math.cos(a) * spread, 0.5 + Math.sin(a) * spread * 0.85, 0.13];
    }
    case 2: {
      // big-left / stack-right
      if (i === 0) return [0.32, 0.5, 0.26];
      const k = (i - 1) / Math.max(1, count - 1);
      return [0.72, lerp(0.24, 0.76, k), 0.1];
    }
    case 3: {
      // top band + bottom accent
      if (i % 2 === 0) return [lerp(0.2, 0.8, i / Math.max(1, count - 1)), 0.3, 0.14];
      return [lerp(0.25, 0.75, i / Math.max(1, count - 1)), 0.72, 0.12];
    }
    default: {
      // scattered but grid-quantized (Memphis)
      const gx = 0.2 + Math.floor(r() * 3) * 0.3;
      const gy = 0.22 + Math.floor(r() * 3) * 0.28;
      return [gx, gy, 0.1 + r() * 0.08];
    }
  }
}

interface PosterState {
  schemeIndex: number;
  layoutId: number;
  barShiftX: number; // bar micro-shift (fraction)
  barShiftY: number;
}

class PosterRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genome: Genome = makeGenome(1);
  private actors: Actor[] = [];

  private state: PosterState = {
    schemeIndex: 0,
    layoutId: 0,
    barShiftX: 0,
    barShiftY: 0,
  };

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;
  private beatCounter = 0;

  /** kick POP: which actor + remaining life (0..1). */
  private popActor = -1;
  private popLife = 0;

  /** snare color-swap latch. */
  private snareLatched = false;

  /** smoothed regime. */
  private smoothDrop = 0;
  private smoothBuildup = 0;

  /** gridless pseudo-meter. */
  private pseudoBeat = 0;

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    this.state.schemeIndex = this.genome.schemeStart;
    this.state.layoutId = this.genome.layoutSeq[0];
    this.rebuildActors();
  }

  private rebuildActors(): void {
    const g = this.genome;
    this.actors = [];
    for (let i = 0; i < g.actorCount; i++) {
      const [hx, hy, size] = layoutFor(this.state.layoutId, i, g.actorCount);
      this.actors.push({
        kind: g.kinds[i],
        hx,
        hy,
        size,
        colorIndex: g.colorSeq[i],
        rot: (i * Math.PI) / 5,
      });
    }
  }

  private recompose(phraseIndex: number): void {
    // full layout recomposition (hard cut) — new layout id from the sequence.
    this.state.layoutId = this.genome.layoutSeq[mod(phraseIndex, this.genome.layoutSeq.length)];
    const g = this.genome;
    for (let i = 0; i < this.actors.length; i++) {
      const [hx, hy, size] = layoutFor(this.state.layoutId, i, g.actorCount);
      this.actors[i].hx = hx;
      this.actors[i].hy = hy;
      this.actors[i].size = size;
      this.actors[i].rot = ((i + phraseIndex) * Math.PI) / 5;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    const bands = frame.bands;
    const slow = frame.bandsSlow ?? frame.bands;
    const energy = energyOf(bands);

    // --- Identity / genome -------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (!this.seeded) {
      const pseudo =
        trackId ??
        (Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1);
      this.reseed(pseudo);
      this.lastTrackId = trackId;
      this.seeded = true;
    } else if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) -----------
    const lowPresence = clamp01((bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.3);
    const drive = Math.max(drop, sustain);

    // --- Metric tiers ------------------------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatWithinBar = Math.floor(clamp01(beat!.barPhase) * 4);
      const beatCell = barIndex * 4 + beatWithinBar;
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeat();
        this.prevBeatCell = beatCell;
      }
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBar(barIndex);
        this.prevBar = barIndex;
      }
    } else {
      this.prevBar = null;
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const beatCell = Math.floor(this.pseudoBeat);
      if (this.prevBeatCell === null || beatCell !== this.prevBeatCell) {
        this.onBeat();
        if (mod(beatCell, 4) === 0) this.onBar(Math.floor(beatCell / 4));
        this.prevBeatCell = beatCell;
      }
    }

    // --- Kick POP: gated on impulse.low; a hard scale snap that settles. ----
    if (frame.impulse.low > 0.32 && this.popLife <= 0.4) {
      this.popActor = this.actors.length > 0 ? mod(this.beatCounter, this.actors.length) : -1;
      this.popLife = 1;
    }
    if (this.popLife > 0) this.popLife = Math.max(0, this.popLife - dt / 0.2);

    // --- Snare: two actors SWAP colors (instant, chroma-only). -------------
    if (frame.impulse.mid > 0.34 && !this.snareLatched) {
      this.snareLatched = true;
      if (this.actors.length >= 2) {
        const a = mod(this.beatCounter, this.actors.length);
        const b = mod(this.beatCounter + 1 + Math.floor(sustain * 2), this.actors.length);
        const t = this.actors[a].colorIndex;
        this.actors[a].colorIndex = this.actors[b].colorIndex;
        this.actors[b].colorIndex = t;
      }
    } else if (frame.impulse.mid < 0.15) {
      this.snareLatched = false;
    }

    // --- Composition drivers (all rate/scale terms ride bandsSlow) ---------
    const scheme = SCHEMES[mod(this.state.schemeIndex, SCHEMES.length)];
    const colors = scheme.slice(1);
    const bg = scheme[0];
    const loudColor = colors[mod(SCHEME_LOUD_INDEX[mod(this.state.schemeIndex, SCHEMES.length)], colors.length)];

    // Drop = background flips to the loudest color; beat-locked pulse (<=2Hz).
    const dropOn = drop > 0.3;
    const pulseStep = dropOn ? Math.floor(frame.time * DROP_PULSE_HZ) % 2 === 0 : false;

    // ---- Field: flat fill (drop flips it) ---------------------------------
    ctx.fillStyle = dropOn ? loudColor : bg;
    ctx.fillRect(0, 0, width, height);

    const unit = Math.min(width, height);
    const scaleParam = frame.params.scale ?? 1;
    const travelParam = frame.params.travel ?? 1;

    // Buildup crowds actors toward center (tension); drop enlarges them.
    const crowd = 0.55 * buildup;
    const maximal = 1 + 0.35 * drive + (pulseStep ? 0.08 : 0);

    // Circle breathe rides bandsSlow.low; bar/zigzag travel rides bandsSlow.mid.
    const breathe = 1 + 0.35 * slow.low;
    const travel = travelParam * (0.04 + 0.14 * slow.mid);
    const skew = (slow.mid - 0.3) * 0.6;

    // ---- Draw actors ------------------------------------------------------
    for (let i = 0; i < this.actors.length; i++) {
      const actor = this.actors[i];
      // home position, pulled toward center by buildup, plus bar micro-shift.
      let fx = lerp(actor.hx, 0.5, crowd) + this.state.barShiftX;
      let fy = lerp(actor.hy, 0.5, crowd) + this.state.barShiftY;
      // mid-driven travel: bars/zigzags drift horizontally (smoothed).
      if (actor.kind === 'bar' || actor.kind === 'zigzag') {
        fx += Math.sin(frame.time * 0.6 + i) * travel;
      }
      const px = fx * width;
      const py = fy * height;

      // kick pop scale on the selected actor (1.15x snap + settle).
      const popScale = i === this.popActor ? 1 + 0.15 * this.popLife : 1;
      const size = actor.size * unit * scaleParam * maximal * popScale;

      const fill = colors[mod(actor.colorIndex - 1, colors.length)];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(actor.rot + skew * 0.2);
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
      this.drawActor(ctx, actor.kind, size, breathe, skew, colors);
      ctx.restore();
    }

    // ---- Accent dots: count rides bandsSlow.high (discrete, grid-placed) --
    const dotCount = Math.round(clamp01(slow.high) * MAX_DOTS);
    if (dotCount > 0) {
      const dotColor = colors[mod(this.state.layoutId + 2, colors.length)];
      ctx.fillStyle = dotColor;
      const cols = 4;
      const dotR = unit * 0.012;
      for (let d = 0; d < dotCount; d++) {
        const gx = 0.12 + (d % cols) * 0.06;
        const gy = 0.9 - Math.floor(d / cols) * 0.05;
        ctx.beginPath();
        ctx.arc(gx * width, gy * height, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawActor(
    ctx: CanvasRenderingContext2D,
    kind: ActorKind,
    size: number,
    breathe: number,
    skew: number,
    colors: string[]
  ): void {
    const s = size;
    switch (kind) {
      case 'circle': {
        // lows drive the breathe scale.
        ctx.beginPath();
        ctx.arc(0, 0, (s * 0.5) * breathe, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'bar': {
        const w = s * 1.3;
        const h = s * 0.4;
        // skew via a parallelogram (mid-driven).
        const dx = h * skew;
        ctx.beginPath();
        ctx.moveTo(-w / 2 + dx, -h / 2);
        ctx.lineTo(w / 2 + dx, -h / 2);
        ctx.lineTo(w / 2 - dx, h / 2);
        ctx.lineTo(-w / 2 - dx, h / 2);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'triangle': {
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.6);
        ctx.lineTo(s * 0.55, s * 0.5);
        ctx.lineTo(-s * 0.55, s * 0.5);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'zigzag': {
        // a thick zigzag stroke (Memphis), skew-animated.
        const steps = 5;
        const w = s * 1.4;
        const amp = s * 0.35 * (0.6 + skew);
        ctx.lineWidth = Math.max(3, s * 0.16);
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        for (let k = 0; k <= steps; k++) {
          const x = -w / 2 + (w * k) / steps;
          const y = (k % 2 === 0 ? -1 : 1) * amp;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        break;
      }
      case 'arc': {
        // a bold half-annulus (flat filled).
        const outer = s * 0.6;
        const inner = s * 0.34;
        ctx.beginPath();
        ctx.arc(0, 0, outer, Math.PI, 0);
        ctx.arc(0, 0, inner, 0, Math.PI, true);
        ctx.closePath();
        ctx.fillStyle = colors[0];
        ctx.fill();
        break;
      }
    }
  }

  // --- Boundary handlers -------------------------------------------------

  private onBeat(): void {
    this.beatCounter++;
    // reset bar micro-shift decays back toward zero over the bar (settle).
    this.state.barShiftX *= 0.6;
    this.state.barShiftY *= 0.6;
  }

  private onBar(barIndex: number): void {
    // bar micro-shift (quantized): a small deterministic nudge.
    const r = splitmix(barIndex * 2749 + this.state.layoutId * 31);
    this.state.barShiftX = (r() - 0.5) * 0.04;
    this.state.barShiftY = (r() - 0.5) * 0.04;
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) this.recompose(Math.floor(barIndex / PHRASE_BARS));
    if (isSection) this.cutSection(Math.floor(barIndex / SECTION_BARS));
  }

  private cutSection(sectionIndex: number): void {
    // PALETTE swap across committed flat schemes (hard cut).
    this.state.schemeIndex = mod(this.genome.schemeStart + sectionIndex, SCHEMES.length);
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'actor scale', min: 0.6, max: 1.6, step: 0.05, default: 1 },
  { id: 'travel', label: 'travel amount', min: 0, max: 2, step: 0.05, default: 1 },
];

const g10PosterPreset: VisualizerPreset = {
  id: 'g10-poster',
  name: 'g10 poster',
  params,
  create: () => new PosterRenderer(),
};

export default g10PosterPreset;
