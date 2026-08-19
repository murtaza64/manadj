/**
 * "g11 shadow" (genetic arena g11, NOVEL — new PULSE representation:
 * LIGHT + SHADOW choreography). A field of simple standing monoliths
 * (flat matte pillars, genome-laid) lit by ONE strong directional light.
 * NOTHING in the scene moves on the kick — instead THE LIGHT is the pulse:
 *
 *   KICK    — the light SNAPS to a new azimuth (hard cut). Every shadow in
 *             the scene swings to a new angle at once; the room "changes"
 *             without a single object moving. Gated on impulse.low.
 *   BASS     — light HEIGHT (elevation). Heavy bass = low raking light =
 *             long dramatic shadows; light bass = overhead neutral, short
 *             shadows. Rides bandsSlow (a HEIGHT is a slow attribute).
 *   MIDS     — the monoliths sway/lean slowly (bandsSlow rate). Palette
 *             color paints the LIT faces.
 *   HIGHS    — thin rim-light shimmer traced along shadow edges (discrete
 *             bright hairline, not glow).
 *   DROP     — the light strobe-WALKS the scene in beat-locked azimuth jumps
 *             (one jump per beat, <=2/s). Photosafety is the CONCEPT: a jump
 *             swaps shadow DIRECTION but total scene luminance stays
 *             near-constant (same lit-area budget, only re-angled), so it is
 *             not a full-field flash. Rides max(drop, energy) so it holds.
 *   BUILDUP  — the light slowly DESCENDS: shadows grow long — dread. Tension
 *             by geometry, not by dimming.
 *   SECTION  — new monolith layout + new palette (hard cut).
 *
 * FLAT LAW: solid matte fills, hard shadow edges, committed palette, NO
 * glow/bloom/additive/feedback/particles. Shadows are crisp polygons drawn
 * source-over. The preset reads as LIGHT CHOREOGRAPHY.
 *
 * Assigned tech: per-band impulse (kick light-snap / high rim), bandsSlow
 * (light height, sway rate), trend drop/buildup split, beat phase + ladder
 * tiers (drop light-walk, section relayout), trackId genome (layout +
 * palette order). Canvas 2D — crisp fills.
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
/** Azimuth stations the light JUMPS between (drop walk + kick snaps pick
 * from these — discrete so shadows are legible, not continuous smear). */
const AZIMUTH_STATIONS = 8;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same layout/palette. */
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
  // dominant: smoothed frame.dominantChannel (layering jitter fix)
  const dom = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (dom && dom.trackId != null) return dom.trackId;
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

/** A committed flat scheme with comparable mean luminance across schemes
 * (section swaps are chroma events, not luminance flashes). ground/lit/
 * shade/rim — bright, saturated (project taste). */
interface Scheme {
  ground: string;
  lit: string;
  shade: string;
  rim: string;
}

const SCHEMES: Scheme[] = [
  // slate ground / hot coral lit / deep ink shade / gold rim
  { ground: '#1a2230', lit: '#ff5a3c', shade: '#0d1119', rim: '#ffd23f' },
  // plum ground / lime lit / violet shade / cyan rim
  { ground: '#241333', lit: '#a6ff2e', shade: '#120a1c', rim: '#00e5ff' },
  // teal ground / magenta lit / navy shade / bone rim
  { ground: '#0f2b2b', lit: '#ff2e88', shade: '#081418', rim: '#f5efe0' },
  // brown ground / cyan lit / maroon shade / amber rim
  { ground: '#2a1c12', lit: '#00c2ff', shade: '#160b08', rim: '#ffb000' },
  // indigo ground / gold lit / black-violet shade / mint rim
  { ground: '#161a33', lit: '#ffcf1a', shade: '#0a0a18', rim: '#4be6a0' },
];

interface Monolith {
  /** normalized field position [-1, 1]. */
  x: number;
  y: number;
  /** half-width and height in field units. */
  hw: number;
  h: number;
  /** per-pillar sway phase offset. */
  phase: number;
}

class ShadowRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;
  private monoliths: Monolith[] = [];

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;

  /** light azimuth: eased current + hard-cut target (kick/drop snap it). */
  private azimuth = 0;
  private azimuthTarget = 0;
  /** drop walk cursor over the azimuth stations. */
  private walkStation = 0;
  /** light elevation (0 = raking/low, 1 = overhead), eased. */
  private elevation = 0.6;
  /** sway accumulator (bandsSlow-driven RATE). */
  private sway = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;
  private pseudoBeat = 0;

  private reseed(key: number): void {
    const r = splitmix(key);
    // palette order
    const order = SCHEMES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    this.schemeOrder = order;
    this.schemeIndex = order[0];
    this.relayout(r);
  }

  /** Lay a small legible field of monoliths (jittered grid rows). */
  private relayout(r: () => number): void {
    const cols = 3 + Math.floor(r() * 3); // 3..5
    const rows = 2 + Math.floor(r() * 2); // 2..3
    const list: Monolith[] = [];
    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < cols; cx++) {
        const jx = (r() - 0.5) * 0.22;
        const jy = (r() - 0.5) * 0.14;
        const x = ((cx + 0.5) / cols) * 2 - 1 + jx;
        const y = ((ry + 0.5) / rows) * 2 - 1 + jy;
        list.push({
          x,
          y,
          hw: 0.04 + r() * 0.05,
          h: 0.16 + r() * 0.22,
          phase: r() * Math.PI * 2,
        });
      }
    }
    // paint back-to-front (higher y = nearer = drawn later)
    list.sort((a, b) => a.y - b.y);
    this.monoliths = list;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    const energy = energyOf(frame.bands);
    const bandsSlow = frame.bandsSlow ?? frame.bands;

    // --- Identity / genome ------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (
      this.lastTrackId === null &&
      trackId === null &&
      this.prevBar === null &&
      this.monoliths.length === 0
    ) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }
    if (this.monoliths.length === 0) this.reseed(1);

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) ----------
    const lowPresence = clamp01((frame.bands.low - 0.2) / 0.5);
    const rAlpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * rAlpha;
    this.smoothBuildup +=
      (frame.trend.excitement * (1 - lowPresence) - this.smoothBuildup) * rAlpha;
    const drop = this.smoothDrop;
    const buildup = this.smoothBuildup;
    const sustain = clamp01(energy * 1.4);
    const drive = Math.max(drop, sustain);
    const dropOn = drive > 0.4;

    // --- Metric tiers (ladder-correct) ------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatInBar = beat!.beatInBar;
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
      // On each beat during a drop: the light WALKS one station (beat-locked,
      // <=2/s at typical BPM, luminance-safe — only shadow direction swaps).
      if (this.prevBeatInBar === null || beatInBar !== this.prevBeatInBar) {
        if (dropOn) {
          this.walkStation = mod(this.walkStation + 3, AZIMUTH_STATIONS);
          this.azimuthTarget = (this.walkStation / AZIMUTH_STATIONS) * Math.PI * 2;
        }
        this.prevBeatInBar = beatInBar;
      }
    } else {
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const pBar = Math.floor(this.pseudoBeat / 4);
      if (this.prevBar === null || pBar !== this.prevBar) {
        this.onBarCut(pBar);
        this.prevBar = pBar;
      }
    }

    // --- Kick light-snap (hard azimuth cut, gated on low impulse) ----------
    // Only when NOT drop-walking (the drop owns the light then).
    if (!dropOn && frame.impulse.low > 0.2) {
      // jump to a fresh station (advance an odd step so it's a real swing).
      this.walkStation = mod(this.walkStation + 3, AZIMUTH_STATIONS);
      this.azimuthTarget = (this.walkStation / AZIMUTH_STATIONS) * Math.PI * 2;
    }
    // Azimuth eases FAST toward its target so the snap reads as a hard cut
    // but never tears (shortest-arc chase).
    {
      let d = this.azimuthTarget - this.azimuth;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const az = 1 - Math.exp(-dt / 0.05);
      this.azimuth += d * az;
    }

    // --- Light elevation: bass HEIGHT, buildup descends -------------------
    // heavy slow bass -> low light (elevation toward 0 = raking). buildup
    // pulls it lower still (shadows grow). bandsSlow so it glides.
    const elTarget = clamp01(0.85 - 0.6 * bandsSlow.low - 0.35 * buildup);
    const elAlpha = 1 - Math.exp(-dt / 0.5);
    this.elevation += (elTarget - this.elevation) * elAlpha;

    // --- Slow sway (bandsSlow.mid drives the RATE) ------------------------
    this.sway += dt * (0.25 + 1.6 * bandsSlow.mid);

    // --- Draw -------------------------------------------------------------
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = scheme.ground;
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height * 0.56;
    const unit = Math.min(width, height);
    const scale = frame.params.scale ?? 1;
    const shadowLen = frame.params.shadowLen ?? 1;
    const rimGain = frame.params.rimGain ?? 1;

    const fieldR = unit * 0.42 * scale;
    // isometric-ish vertical squash for the ground plane.
    const squash = 0.5;

    // Shadow direction on the ground = opposite the light azimuth. Shadow
    // LENGTH grows as the light lowers (elevation → 0): long raking shadows.
    const shadowDir = this.azimuth + Math.PI;
    const rakeLen = (0.35 + 1.6 * (1 - this.elevation)) * shadowLen;
    const sdx = Math.cos(shadowDir) * rakeLen;
    const sdy = Math.sin(shadowDir) * rakeLen * squash;

    const toScreen = (fx: number, fy: number): [number, number] => [
      cx + fx * fieldR,
      cy + fy * fieldR * squash,
    ];

    // sway: lean the whole field slightly with the mids, phase-varied.
    const leanBase = 0.05 * Math.sin(this.sway);

    // PASS 1: all shadows first (crisp dark polygons on the ground).
    ctx.fillStyle = scheme.shade;
    for (const m of this.monoliths) {
      const lean = leanBase + 0.03 * Math.sin(this.sway + m.phase);
      const [bx, by] = toScreen(m.x, m.y);
      const halfW = m.hw * fieldR;
      // pillar base corners (foot on the ground)
      const bl: [number, number] = [bx - halfW, by];
      const br: [number, number] = [bx + halfW, by];
      // shadow is the base swept along the ground shadow vector.
      const sweepX = sdx * fieldR * m.h;
      const sweepY = sdy * fieldR * m.h;
      ctx.beginPath();
      ctx.moveTo(bl[0], bl[1]);
      ctx.lineTo(br[0], br[1]);
      ctx.lineTo(br[0] + sweepX + lean * fieldR, br[1] + sweepY);
      ctx.lineTo(bl[0] + sweepX + lean * fieldR, bl[1] + sweepY);
      ctx.closePath();
      ctx.fill();
    }

    // PASS 2: the monoliths themselves (lit faces + rim-lit shadow edge).
    // Lit-face brightness rides where the light is relative to the pillar:
    // total lit area stays near-constant across azimuth jumps (photosafe).
    const litColor = scheme.lit;
    const rimBase = clamp01((frame.impulse.high * 0.8 + frame.bands.high * 0.2) * rimGain);
    for (const m of this.monoliths) {
      const lean = leanBase + 0.03 * Math.sin(this.sway + m.phase);
      const [bx, by] = toScreen(m.x, m.y);
      const halfW = m.hw * fieldR;
      const pillarH = m.h * fieldR * (2.0 + 0.4 * drive);
      const topL: [number, number] = [bx - halfW + lean * fieldR, by - pillarH];
      const topR: [number, number] = [bx + halfW + lean * fieldR, by - pillarH];
      const botL: [number, number] = [bx - halfW, by];
      const botR: [number, number] = [bx + halfW, by];

      // Body (lit face) — flat matte lit color, sway-tinted brightness so the
      // scene is legible but not flashing.
      ctx.fillStyle = litColor;
      ctx.beginPath();
      ctx.moveTo(topL[0], topL[1]);
      ctx.lineTo(topR[0], topR[1]);
      ctx.lineTo(botR[0], botR[1]);
      ctx.lineTo(botL[0], botL[1]);
      ctx.closePath();
      ctx.fill();

      // Cap (top face) in the ground tone — reads the pillar as a solid.
      ctx.fillStyle = scheme.ground;
      ctx.beginPath();
      ctx.moveTo(topL[0], topL[1]);
      ctx.lineTo(topR[0], topR[1]);
      ctx.lineTo(topR[0] + halfW * 0.25, topL[1] - halfW * 0.5);
      ctx.lineTo(topL[0] + halfW * 0.25, topL[1] - halfW * 0.5);
      ctx.closePath();
      ctx.fill();

      // RIM shimmer: a thin bright hairline on the SHADOW-side vertical edge
      // (highs). Side depends on light azimuth — a crisp line, not glow.
      if (rimBase > 0.04) {
        const rimOnLeft = Math.cos(this.azimuth) > 0;
        const ex: [number, number] = rimOnLeft ? topL : topR;
        const eb: [number, number] = rimOnLeft ? botL : botR;
        ctx.strokeStyle = scheme.rim;
        ctx.lineWidth = Math.max(1, unit * 0.004 * rimBase);
        ctx.globalAlpha = clamp01(0.35 + 0.65 * rimBase);
        ctx.beginPath();
        ctx.moveTo(ex[0], ex[1]);
        ctx.lineTo(eb[0], eb[1]);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // A single bright light MARKER (small solid disc) on the ground at the
    // light azimuth — anchors the choreography, tells the eye where the pulse
    // is. Localized pulse (photosafe), not a full-field flash.
    const markR = fieldR * (0.9 + 0.05 * this.elevation);
    const [mkx, mky] = [
      cx + Math.cos(this.azimuth) * markR,
      cy + Math.sin(this.azimuth) * markR * squash,
    ];
    ctx.fillStyle = scheme.rim;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(mkx, mky, unit * (0.012 + 0.01 * (1 - this.elevation)), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private onBarCut(barIndex: number): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
      // new layout on section boundary (hard cut).
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      this.relayout(r);
    } else if (isPhrase) {
      // phrase: nudge the light to a fresh station so the room re-angles even
      // outside drops.
      this.walkStation = mod(this.walkStation + 2, AZIMUTH_STATIONS);
      this.azimuthTarget = (this.walkStation / AZIMUTH_STATIONS) * Math.PI * 2;
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'field scale', min: 0.6, max: 1.4, step: 0.05, default: 1 },
  { id: 'shadowLen', label: 'shadow length', min: 0.5, max: 2, step: 0.05, default: 1.1 },
  { id: 'rimGain', label: 'rim shimmer', min: 0, max: 2, step: 0.05, default: 1 },
];

const g11ShadowPreset: VisualizerPreset = {
  id: 'g11-shadow',
  name: 'g11 shadow',
  params,
  create: () => new ShadowRenderer(),
};

export default g11ShadowPreset;
