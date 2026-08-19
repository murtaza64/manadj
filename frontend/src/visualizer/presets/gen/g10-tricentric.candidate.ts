/**
 * "g10 tricentric" (genetic arena g10, FLAT wave, NOVEL; Vissonance
 * 'Tricentric' tradition). Human ask: flat color schemes, less noisy.
 *
 * A clean geometric TUNNEL of concentric flat polygon rings receding toward
 * an OFF-CENTER vanishing point. No glow, no haze, no particles — solid matte
 * fills and hard outlines on a dark flat background. The whole scene is
 * TRANSFORMS (scale/advance/rotate/flip) and COLOR SWAPS on the grid; depth
 * comes from flat-shaded receding polygons (Vissonance tradition), never from
 * additive light.
 *
 * FLAT LAW (this wave): committed 4-color scheme; every element paints from
 * that scheme with hard edges. Motion RIDES bandsSlow (motion smoothness law);
 * instantaneous bands/impulse drive only pops/punches. No feedback buffer.
 *
 * The grammar:
 *   - Tunnel ADVANCE speed rides bandsSlow.low (rings drift inward toward the
 *     vanishing point at a smoothed rate — never jerks on a transient).
 *   - Ring STROKE WEIGHT rides mids: thin outlines when quiet, bold when busy.
 *   - Every Nth ring is SOLID-filled from the flat scheme; the others are thin
 *     outlines on the flat background.
 *   - Polygon SIDES cycle 3->4->6 on the BAR (quantized, hard step).
 *   - KICK = the nearest ring SNAPS one advance-step closer + solid-fills for
 *     a beat (a POP, gated on impulse.low so it isn't kick-powder).
 *   - SNARE = one ring rotates 30 degrees (a hard step, not a spin).
 *   - PHRASE (4 bars) = scheme rotates one color (the palette cycles).
 *   - SECTION (16 bars) = scheme SWAP + vanishing point relocates (hard cut).
 *   - DROP = rings alternate solid/outline in a STROBE-SAFE pattern — CHROMA
 *     alternation only (swap which scheme color fills, luminance held), toggled
 *     at <=2Hz (photosafe; never a luminance strobe). Tunnel speed rides
 *     max(drop, energy) via bandsSlow.
 *
 * Genome: the dominant audible deck's trackId picks the scheme family, the
 * solid-ring period N, and the vanishing-point orbit — same song, same tunnel.
 * No trackId => frozen pseudo-seed.
 *
 * Anti-resemblance: NOT a glowy tunnel; flat polygon rings, hard edges only.
 * Canvas 2D, no compositing tricks, source-over throughout.
 *
 * Assigned tech: bandsSlow (advance/weight velocity), impulses (kick pop /
 * snare step), ladder tiers bar/phrase/section (beat.ladderBarIndex ??
 * barIndex), trend (drop chroma-strobe), trackId genome.
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
const RING_COUNT = 14;
const DROP_STROBE_HZ = 2; // photosafe ceiling for the chroma alternation

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32-style avalanche → stable [0,1). Same key ⇒ same tunnel. */
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

/** A committed flat 4-color scheme (matte fills + a dark flat background).
 * All hard, saturated (this repo dislikes pastels). Stored as [h,s,l]. */
interface Scheme {
  bg: [number, number, number];
  colors: Array<[number, number, number]>; // exactly 4 flat matte colors
}

/** Bold flat scheme families (Swiss/Vissonance flavor). Bright, committed. */
const SCHEME_FAMILIES: Scheme[] = [
  {
    // brick / mustard / cream / navy
    bg: [222, 45, 12],
    colors: [
      [8, 82, 52],
      [42, 90, 55],
      [46, 40, 82],
      [222, 70, 30],
    ],
  },
  {
    // teal / orange / sand / charcoal
    bg: [200, 30, 10],
    colors: [
      [180, 75, 45],
      [26, 92, 55],
      [40, 45, 72],
      [210, 20, 22],
    ],
  },
  {
    // magenta / lime / cyan / deep violet
    bg: [270, 55, 9],
    colors: [
      [320, 90, 55],
      [95, 85, 50],
      [190, 90, 52],
      [275, 65, 28],
    ],
  },
  {
    // red / gold / white-ish / oxblood
    bg: [0, 40, 10],
    colors: [
      [0, 88, 52],
      [44, 95, 55],
      [40, 20, 85],
      [352, 65, 30],
    ],
  },
];

const POLY_SIDES = [3, 4, 6]; // bar cycles through these

function hsl([h, s, l]: [number, number, number], alpha = 1): string {
  return `hsla(${mod(h, 360).toFixed(1)}, ${s}%, ${l}%, ${alpha})`;
}

interface Genome {
  schemeStart: number; // starting scheme-family index
  solidPeriod: number; // every Nth ring is solid (3..5)
  vpBank: Array<[number, number]>; // vanishing-point offsets per section (unit fractions)
  baseRotate: number; // seeded base tunnel twist
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const vpBank: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    vpBank.push([(r() - 0.5) * 0.5, (r() - 0.5) * 0.42]);
  }
  return {
    schemeStart: Math.floor(r() * SCHEME_FAMILIES.length),
    solidPeriod: 3 + Math.floor(r() * 3), // 3..5
    vpBank,
    baseRotate: (r() - 0.5) * 0.6,
  };
}

/** Held tunnel state — only rewritten on the owning tier's boundary. */
interface TunnelState {
  sidesIndex: number; // which POLY_SIDES entry (bar cycle)
  schemeIndex: number; // which scheme family (section swap)
  colorRotation: number; // phrase rotates the palette by this many steps
  vp: [number, number]; // vanishing-point offset (fraction of unit)
  ringRotStep: number; // snare-driven 30-degree steps accumulated
}

class TricentricRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genome: Genome = makeGenome(1);

  private state: TunnelState = {
    sidesIndex: 1,
    schemeIndex: 0,
    colorRotation: 0,
    vp: [0.18, -0.12],
    ringRotStep: 0,
  };

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;

  /** continuous inward advance phase (0..1 across one ring spacing). */
  private advance = 0;
  /** kick pop: the nearest ring's snapped-solid life (0..1). */
  private popLife = 0;
  /** snare hard-rotation latch (fires one 30-degree step per snare). */
  private snareLatched = false;

  /** smoothed regime split. */
  private smoothDrop = 0;
  private smoothBuildup = 0;

  /** gridless pseudo-meter. */
  private pseudoBeat = 0;

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    this.state.schemeIndex = this.genome.schemeStart;
    this.state.vp = this.genome.vpBank[0];
    this.state.colorRotation = 0;
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

    // --- Snare = one hard 30-degree ring rotation (latched, chroma-neutral) -
    if (frame.impulse.mid > 0.34 && !this.snareLatched) {
      this.state.ringRotStep = mod(this.state.ringRotStep + 1, 12);
      this.snareLatched = true;
    } else if (frame.impulse.mid < 0.15) {
      this.snareLatched = false;
    }

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

    // --- Kick POP: nearest ring snaps a step closer + solid-fills. Gated on
    // impulse.low (kick clicks are broadband) so it isn't kick-powder. ------
    if (frame.impulse.low > 0.32 && this.popLife <= 0) {
      this.popLife = 1;
      // hard snap the tunnel one advance step closer.
      this.advance = clamp01(this.advance + 0.35);
    }
    if (this.popLife > 0) this.popLife = Math.max(0, this.popLife - dt / 0.22);

    // --- Continuous inward ADVANCE rides bandsSlow.low (motion law), lifted
    // on drops via max(drop, energy). Never rides instantaneous bands. -----
    const advanceSpeed = 0.15 + 1.1 * slow.low + 1.3 * drive + 0.4 * buildup;
    this.advance += dt * advanceSpeed;
    while (this.advance >= 1) {
      this.advance -= 1;
      // a ring reached the vanishing point; recycle (no per-ring identity to
      // shift — the solid/outline pattern is positional).
    }

    // --- Drop chroma-strobe phase (<=2Hz, chroma only, luminance held) -----
    const strobeOn =
      drop > 0.28 ? Math.floor(frame.time * DROP_STROBE_HZ) % 2 === 0 : false;

    // --- Scheme (with phrase color-rotation) -------------------------------
    const scheme = SCHEME_FAMILIES[mod(this.state.schemeIndex, SCHEME_FAMILIES.length)];
    const rot = this.state.colorRotation;
    const pick = (i: number): [number, number, number] =>
      scheme.colors[mod(i + rot, scheme.colors.length)];

    // ---- Background: dark flat regime (hard fill, no gradient) ------------
    ctx.fillStyle = hsl(scheme.bg);
    ctx.fillRect(0, 0, width, height);

    // ---- Tunnel geometry --------------------------------------------------
    const unit = Math.min(width, height);
    const cx = width / 2 + this.state.vp[0] * width;
    const cy = height / 2 + this.state.vp[1] * height;
    const scale = frame.params.scale ?? 1;
    const weightParam = frame.params.weight ?? 1;
    const sides = POLY_SIDES[mod(this.state.sidesIndex, POLY_SIDES.length)];
    const period = this.genome.solidPeriod;

    // Stroke weight rides mids (bold when busy). Instantaneous mid is fine for
    // a WIDTH (a size, not a velocity) — but keep it stable via slow mids so
    // it doesn't jitter.
    const strokeW = Math.max(1.5, unit * 0.006 * weightParam * (0.6 + 2.4 * slow.mid));

    // Base twist: seeded + a slow snare-stepped rotation + gentle drift.
    const baseTwist =
      this.genome.baseRotate +
      this.state.ringRotStep * (Math.PI / 6) +
      frame.time * 0.02 * (0.5 + slow.high);

    // Draw rings from FAR (small, near vanishing point) to NEAR (large) so
    // near rings paint over far ones (flat depth ordering).
    const maxR = unit * 0.62 * scale;
    const minR = unit * 0.03;
    ctx.lineJoin = 'miter';
    for (let i = RING_COUNT - 1; i >= 0; i--) {
      // ring depth position 0..1, offset by the continuous advance so the
      // whole tunnel drifts inward smoothly.
      const t = (i + this.advance) / RING_COUNT;
      if (t <= 0 || t > 1.05) continue;
      // perspective: radius grows non-linearly toward the near plane.
      const r = minR + (maxR - minR) * (t * t);
      // each ring twists slightly more the farther out (tunnel shear).
      const twist = baseTwist + (1 - t) * 0.5;

      // Is this a SOLID ring? every Nth positionally, but the kick POP forces
      // the NEAREST (largest) ring solid for a beat.
      const positional = mod(i, period) === 0;
      const isNearest = i === RING_COUNT - 1;
      const kickSolid = isNearest && this.popLife > 0.05;
      let solid = positional || kickSolid;

      // Drop CHROMA-strobe: alternate which rings read solid vs outline, but
      // only swap the CHROMA (fill color index), never luminance — photosafe.
      let colorIdx = Math.floor(t * scheme.colors.length * 1.5) % scheme.colors.length;
      if (strobeOn) {
        // flip solidity parity for chroma alternation (a color swap in effect,
        // luminance of bg/fill unchanged frame to frame beyond the swap).
        solid = mod(i, 2) === 0;
        colorIdx = mod(colorIdx + 1, scheme.colors.length);
      }

      const fillCol = pick(colorIdx);
      const strokeCol = pick(colorIdx + 2);

      // Build the polygon path.
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const th = twist + (s / sides) * Math.PI * 2 - Math.PI / 2;
        const px = cx + Math.cos(th) * r;
        const py = cy + Math.sin(th) * r;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      if (solid) {
        // Solid matte fill; near rings slightly brighter for flat depth
        // (a fixed per-depth lightness, NOT a per-frame flash).
        const depthL = fillCol[2] * (0.7 + 0.35 * t);
        ctx.fillStyle = hsl([fillCol[0], fillCol[1], Math.min(70, depthL)]);
        ctx.fill();
        // a hard outline on top keeps the edge crisp.
        ctx.lineWidth = strokeW * 0.7;
        ctx.strokeStyle = hsl(strokeCol, 0.9);
        ctx.stroke();
      } else {
        // Thin outline only — flat background shows through.
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = hsl([strokeCol[0], strokeCol[1], strokeCol[2] * (0.6 + 0.5 * t)]);
        ctx.stroke();
      }
    }

    // ---- Kick POP accent: nearest ring gets a bold accent edge for a beat.
    // A hard, localized edge thickening (a POP, not a fullscreen flash). ----
    if (this.popLife > 0.02) {
      const t = (RING_COUNT - 1 + this.advance) / RING_COUNT;
      const r = minR + (maxR - minR) * (t * t);
      const twist = baseTwist + (1 - t) * 0.5;
      const accent = pick(1);
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const th = twist + (s / sides) * Math.PI * 2 - Math.PI / 2;
        const px = cx + Math.cos(th) * r;
        const py = cy + Math.sin(th) * r;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.lineWidth = strokeW * (1.2 + 1.8 * this.popLife);
      ctx.strokeStyle = hsl(accent, 0.85 + 0.15 * this.popLife);
      ctx.stroke();
    }

    // ---- Center mark: a small solid polygon at the vanishing point (the
    // tunnel's core), flat-filled from the scheme. ------------------------
    const coreR = unit * (0.012 + 0.02 * bands.low);
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const th = baseTwist + (s / sides) * Math.PI * 2 - Math.PI / 2;
      const px = cx + Math.cos(th) * coreR;
      const py = cy + Math.sin(th) * coreR;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = hsl(pick(2));
    ctx.fill();
  }

  // --- Boundary handlers -------------------------------------------------

  private onBeat(): void {
    // beats are carried by the continuous advance + kick pop; nothing held
    // rewrites here (kept for pseudo-meter symmetry).
  }

  private onBar(barIndex: number): void {
    // Polygon SIDES cycle 3->4->6 on the bar (quantized hard step).
    this.state.sidesIndex = mod(barIndex, POLY_SIDES.length);
    // SNARE-style hard rotation step every bar's 3rd beat is handled via the
    // dedicated snare hook below; the bar itself advances the sides.
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) this.cutPhrase(Math.floor(barIndex / PHRASE_BARS));
    if (isSection) this.cutSection(Math.floor(barIndex / SECTION_BARS));
  }

  private cutPhrase(phraseIndex: number): void {
    // PHRASE = scheme rotates one color (palette cycles by one step).
    this.state.colorRotation = mod(phraseIndex, 4);
  }

  private cutSection(sectionIndex: number): void {
    // SECTION = scheme SWAP + vanishing point relocates (hard cut).
    this.state.schemeIndex = mod(this.genome.schemeStart + sectionIndex, SCHEME_FAMILIES.length);
    this.state.vp = this.genome.vpBank[mod(sectionIndex, this.genome.vpBank.length)];
    // a hard 30-degree ring rotation marks the cut too.
    this.state.ringRotStep = mod(this.state.ringRotStep + 1, 12);
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'tunnel scale', min: 0.6, max: 1.6, step: 0.05, default: 1 },
  { id: 'weight', label: 'ring stroke weight', min: 0.4, max: 2.5, step: 0.05, default: 1 },
];

const g10TricentricPreset: VisualizerPreset = {
  id: 'g10-tricentric',
  name: 'g10 tricentric',
  params,
  create: () => new TricentricRenderer(),
};

export default g10TricentricPreset;
