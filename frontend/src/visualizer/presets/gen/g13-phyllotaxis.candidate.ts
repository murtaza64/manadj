/**
 * "g13 phyllotaxis" (genetic arena g13, ABSTRACT MATHEMATICS territory,
 * NOVEL). A golden-angle seed-head (Vogel's model): the nth floret sits at
 * angle n·137.507 degrees and radius sqrt(n)·spacing — the sunflower /
 * pinecone lattice. DISCRETE flat matte polygons on a dark floor, grown to
 * the beat with hard integer count-jumps. No feedback buffer, no glow, no
 * blur, no dust — canvas 2D, source-over throughout.
 *
 * Anti-resemblance: NOT a hypno spiral (those are analytic rotating band
 * arms); this is a fixed-position discrete point set whose COUNT grows with
 * the music and whose color is banded by ring ordinal. Not stained glass,
 * not color-organ ribbons, not mirror strata.
 *
 * FLAT LAW: committed scheme, hard edges, dark background, matte fills.
 * Motion (head rotation drift, breathing zoom) rides bandsSlow (motion
 * smoothness law); instantaneous bands/impulse drive only brightness pops
 * and count snaps.
 *
 * Per-band vocabulary (legible causality):
 *   LOW  = the head PULSES outward (spacing/scale) + kick snaps the newest
 *          outer ring solid-bright for a beat (gated on impulse.low so it is
 *          not kick-powder).
 *   MID  = snare rotates the WHOLE head one hard parastichy step (quantized
 *          turn) + sets floret fill weight.
 *   HIGH = hats glint the OUTERMOST (youngest) ring only — a rim accent, not
 *          field dust.
 *
 * Quantized grammar (beat.ladderBarIndex ?? barIndex; pseudo-meter when
 * gridless):
 *   BEAT    = count grows one integer step (florets bloom outward in order).
 *   BAR     = floret polygon SIDES cycle 5 -> 6 -> 8 (hard step).
 *   PHRASE  = scheme rotates one color; parastichy handedness may flip.
 *   SECTION = scheme SWAP + head relocates + growth resets to a floor and
 *             re-blooms (theatre).
 *   DROP    = growth ceiling lifts (dense head) riding max(drop, energy);
 *             alternate rings read solid vs outline in a CHROMA-only,
 *             luminance-held, <=2 Hz alternation (photosafe).
 *
 * Genome: dominant audible deck trackId seeds the scheme family, sides-cycle
 * phase, handedness, and section relocation orbit. No trackId => frozen
 * pseudo-seed.
 *
 * Assigned tech: bandsSlow (rotation/zoom velocity), per-band impulses,
 * trend drop/buildup split, centroid (leading scheme color), ladder tiers,
 * trackId genome.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.507 degrees, radians
const PHRASE_BARS = 4;
const SECTION_BARS = 16;
const MAX_FLORETS = 620; // hard ceiling on drawn points
const FLOOR_FLORETS = 40; // seeded re-bloom floor
const POLY_SIDES = [5, 6, 8]; // seed-head facet, bar-cycled
const DROP_STROBE_HZ = 2; // photosafe chroma alternation ceiling

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same head. */
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

/** A committed flat scheme (dark floor + matte saturated ring colors),
 * stored as [h,s,l]. This repo dislikes pastels — high saturation. */
interface Scheme {
  bg: [number, number, number];
  rings: Array<[number, number, number]>; // ring-banding palette
}

const SCHEME_FAMILIES: Scheme[] = [
  {
    // solar: amber / vermilion / gold / deep ember floor
    bg: [18, 60, 6],
    rings: [
      [40, 95, 55],
      [12, 92, 52],
      [50, 90, 58],
      [28, 88, 48],
    ],
  },
  {
    // botanical: lime / cyan / chartreuse / midnight floor
    bg: [190, 55, 6],
    rings: [
      [95, 88, 52],
      [180, 90, 50],
      [140, 85, 50],
      [70, 88, 55],
    ],
  },
  {
    // ultraviolet: magenta / violet / cyan / near-black plum floor
    bg: [280, 55, 7],
    rings: [
      [320, 92, 56],
      [275, 85, 55],
      [200, 90, 55],
      [345, 88, 52],
    ],
  },
  {
    // ember-ice: rose / ice-blue / gold / oxblood floor
    bg: [0, 45, 7],
    rings: [
      [350, 90, 55],
      [205, 88, 55],
      [46, 92, 58],
      [18, 85, 50],
    ],
  },
];

function hsl([h, s, l]: [number, number, number], alpha = 1): string {
  return `hsla(${mod(h, 360).toFixed(1)}, ${s}%, ${Math.min(72, Math.max(0, l))}%, ${alpha})`;
}

interface Genome {
  schemeStart: number;
  sidesPhase: number; // starting offset into the bar sides cycle
  handed: number; // parastichy handedness (+1 / -1)
  relocateBank: Array<[number, number]>; // section head offsets (unit fractions)
  baseTwist: number;
}

function makeGenome(key: number): Genome {
  const r = splitmix(key);
  const relocateBank: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    relocateBank.push([(r() - 0.5) * 0.42, (r() - 0.5) * 0.34]);
  }
  return {
    schemeStart: Math.floor(r() * SCHEME_FAMILIES.length),
    sidesPhase: Math.floor(r() * POLY_SIDES.length),
    handed: r() < 0.5 ? 1 : -1,
    relocateBank,
    baseTwist: (r() - 0.5) * Math.PI,
  };
}

/** Held head state — only rewritten on its owning tier's boundary. */
interface HeadState {
  schemeIndex: number;
  colorRotation: number;
  sidesIndex: number;
  handed: number;
  center: [number, number]; // fraction-of-canvas offset
  turnSteps: number; // snare-driven parastichy turns accumulated
}

class PhyllotaxisRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private seeded = false;
  private genome: Genome = makeGenome(1);

  private state: HeadState = {
    schemeIndex: 0,
    colorRotation: 0,
    sidesIndex: 0,
    handed: 1,
    center: [0, 0],
    turnSteps: 0,
  };

  private prevBar: number | null = null;
  private prevBeatCell: number | null = null;

  /** Grown floret count, snapped up on beats/kicks, decays gently between. */
  private grownCount = FLOOR_FLORETS;
  /** Continuous head rotation drift (rides bandsSlow). */
  private rotation = 0;
  /** Breathing zoom phase (rides bandsSlow). */
  private breath = 0;
  /** kick pop: newest-ring solid-bright life (0..1). */
  private popLife = 0;
  private kickLatched = false;
  /** snare hard-turn latch. */
  private snareLatched = false;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  private pseudoBeat = 0;

  private reseed(key: number): void {
    this.genome = makeGenome(key);
    this.state.schemeIndex = this.genome.schemeStart;
    this.state.sidesIndex = this.genome.sidesPhase;
    this.state.handed = this.genome.handed;
    this.state.center = this.genome.relocateBank[0];
    this.state.colorRotation = 0;
    this.state.turnSteps = 0;
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

    // --- Snare = one hard parastichy TURN (latched, quantized) -------------
    if (frame.impulse.mid > 0.34 && !this.snareLatched) {
      this.state.turnSteps = mod(this.state.turnSteps + 1, 34); // 34 ~ Fibonacci parastichy count
      this.snareLatched = true;
    } else if (frame.impulse.mid < 0.15) {
      this.snareLatched = false;
    }

    // --- Kick = count snaps up + newest ring solid-bright pop. Gated on
    // impulse.low (kick clicks are broadband) so it isn't kick-powder. ------
    if (frame.impulse.low > 0.32 && !this.kickLatched) {
      this.popLife = 1;
      this.grownCount = Math.min(MAX_FLORETS, this.grownCount + 22);
      this.kickLatched = true;
    } else if (frame.impulse.low < 0.16) {
      this.kickLatched = false;
    }
    if (this.popLife > 0) this.popLife = Math.max(0, this.popLife - dt / 0.24);

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

    // --- Growth ceiling: drops lift the whole head dense (ride max(drop,
    // energy)); otherwise the count decays gently toward a live floor so the
    // head breathes between beats without smoothly interpolating the bloom. -
    const ceiling = FLOOR_FLORETS + (MAX_FLORETS - FLOOR_FLORETS) * clamp01(0.35 + 0.75 * drive + 0.4 * buildup);
    if (this.grownCount > ceiling) {
      this.grownCount += (ceiling - this.grownCount) * (1 - Math.exp(-dt / 0.9));
    }
    // slow live floor so a quiet passage keeps a small head, never blank.
    const liveFloor = FLOOR_FLORETS + 90 * clamp01(energy * 1.2);
    if (this.grownCount < liveFloor) {
      this.grownCount += (liveFloor - this.grownCount) * (1 - Math.exp(-dt / 0.6));
    }
    const drawnCount = Math.max(1, Math.min(MAX_FLORETS, Math.round(this.grownCount)));

    // --- Continuous rotation drift + breathing zoom ride bandsSlow only. ---
    this.rotation += dt * this.state.handed * (0.05 + 0.5 * slow.mid + 0.5 * drive);
    this.breath += dt * (0.4 + 1.6 * slow.low);

    // --- Drop CHROMA-strobe (chroma only, luminance held, <=2 Hz). ---------
    const strobeOn = drop > 0.28 ? Math.floor(frame.time * DROP_STROBE_HZ) % 2 === 0 : false;

    // --- Scheme (phrase color rotation) ------------------------------------
    const scheme = SCHEME_FAMILIES[mod(this.state.schemeIndex, SCHEME_FAMILIES.length)];
    const rot = this.state.colorRotation;
    // centroid rotates which ring color leads (color free to travel).
    const centroidLead = Math.floor(clamp01(frame.centroid) * scheme.rings.length);
    const pickRing = (ringOrdinal: number): [number, number, number] =>
      scheme.rings[mod(ringOrdinal + rot + centroidLead, scheme.rings.length)];

    // ---- Dark flat floor (hard fill, no gradient) -------------------------
    ctx.fillStyle = hsl(scheme.bg);
    ctx.fillRect(0, 0, width, height);

    // ---- Head geometry ----------------------------------------------------
    const unit = Math.min(width, height);
    const cx = width / 2 + this.state.center[0] * width;
    const cy = height / 2 + this.state.center[1] * height;
    const scaleParam = frame.params.scale ?? 1;
    const sizeParam = frame.params.size ?? 1;

    // Head breathes (rides slow.low via the breath phase — a size, bounded).
    const breathZoom = 1 + 0.08 * Math.sin(this.breath) * (0.4 + slow.low);
    // Spacing pulses outward with LOW (a scale, stable via slow low + gentle
    // instantaneous accent bounded so it can't strobe).
    const spacing = unit * 0.028 * scaleParam * breathZoom * (0.85 + 0.5 * slow.low + 0.25 * bands.low);

    const headTwist = this.genome.baseTwist + this.rotation + this.state.turnSteps * GOLDEN_ANGLE;
    const sides = POLY_SIDES[mod(this.state.sidesIndex, POLY_SIDES.length)];
    const handed = this.state.handed;

    // floret base radius (a size): mids set fill weight -> polygon radius.
    const floretR = unit * 0.011 * sizeParam * (0.7 + 0.9 * slow.mid);

    // The youngest ring ordinal (for hat glints + kick pop): florets whose
    // index is within the last ~1 sqrt-ring of drawnCount.
    const maxRingOrdinal = Math.floor(Math.sqrt(drawnCount - 1));

    // ---- Draw florets from OLDEST (inner) to YOUNGEST (outer) so outer
    // florets paint over inner ones (flat depth ordering). -----------------
    ctx.lineJoin = 'round';
    for (let n = 0; n < drawnCount; n++) {
      const ringOrdinal = Math.floor(Math.sqrt(n)); // concentric parastichy band
      const angle = handed * n * GOLDEN_ANGLE + headTwist;
      const r = spacing * Math.sqrt(n);
      const fx = cx + Math.cos(angle) * r;
      const fy = cy + Math.sin(angle) * r;
      // cull off-canvas florets (cheap; keeps big heads bounded).
      if (fx < -floretR * 3 || fx > width + floretR * 3 || fy < -floretR * 3 || fy > height + floretR * 3) {
        continue;
      }

      const isYoungestRing = ringOrdinal >= maxRingOrdinal;
      let col = pickRing(ringOrdinal);

      // Drop chroma alternation: swap which ring color fills on alternate
      // rings, CHROMA only (indices), luminance held.
      let solid = true;
      if (strobeOn) {
        solid = mod(ringOrdinal, 2) === 0;
        col = pickRing(ringOrdinal + 1);
      }

      // Kick pop: the youngest ring reads solid-bright for a beat (localized,
      // not fullscreen — photosafe). A bounded lightness lift.
      const popLift = isYoungestRing ? this.popLife * 0.18 : 0;

      // Floret polygon radius grows slightly toward the rim (flat depth).
      const depthT = drawnCount > 1 ? n / (drawnCount - 1) : 0;
      const fr = floretR * (0.55 + 0.75 * depthT) + (isYoungestRing ? floretR * 0.35 * this.popLife : 0);

      // rotate each floret slightly by its own angle (facet orientation).
      ctx.beginPath();
      for (let s = 0; s <= sides; s++) {
        const th = angle + (s / sides) * Math.PI * 2;
        const px = fx + Math.cos(th) * fr;
        const py = fy + Math.sin(th) * fr;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      if (solid) {
        ctx.fillStyle = hsl([col[0], col[1], col[2] + popLift * 100]);
        ctx.fill();
      } else {
        // outline-only floret on this ring (chroma alternation reads as a
        // hard band swap; luminance of the floor is unchanged).
        ctx.lineWidth = Math.max(1, fr * 0.4);
        ctx.strokeStyle = hsl(col, 0.95);
        ctx.stroke();
      }

      // HIGH = hats glint the OUTERMOST ring only: a hard rim accent edge on
      // youngest florets, scaled by instantaneous high impulse (a per-floret
      // pop, not field dust).
      if (isYoungestRing && frame.impulse.high > 0.28) {
        const glint = pickRing(ringOrdinal + 2);
        ctx.lineWidth = Math.max(1, fr * 0.5 * frame.impulse.high);
        ctx.strokeStyle = hsl([glint[0], Math.min(100, glint[1] + 8), glint[2] + 8], 0.9);
        ctx.stroke();
      }
    }

    // ---- Core mark: a small solid polygon at the head center (the meristem)
    const coreR = unit * (0.01 + 0.02 * bands.low);
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const th = headTwist + (s / sides) * Math.PI * 2;
      const px = cx + Math.cos(th) * coreR;
      const py = cy + Math.sin(th) * coreR;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = hsl(pickRing(0));
    ctx.fill();
  }

  // --- Boundary handlers -------------------------------------------------

  private onBeat(): void {
    // BEAT = count grows one integer step (florets bloom outward in order).
    this.grownCount = Math.min(MAX_FLORETS, this.grownCount + 14);
  }

  private onBar(barIndex: number): void {
    // BAR = floret polygon SIDES cycle 5 -> 6 -> 8 (hard step).
    this.state.sidesIndex = mod(barIndex + this.genome.sidesPhase, POLY_SIDES.length);
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) this.cutPhrase(Math.floor(barIndex / PHRASE_BARS));
    if (isSection) this.cutSection(Math.floor(barIndex / SECTION_BARS));
  }

  private cutPhrase(phraseIndex: number): void {
    // PHRASE = scheme rotates one color; parastichy handedness may flip.
    this.state.colorRotation = mod(phraseIndex, SCHEME_FAMILIES[0].rings.length);
    if (mod(phraseIndex, 2) === 1) this.state.handed = -this.state.handed;
  }

  private cutSection(sectionIndex: number): void {
    // SECTION = scheme SWAP + head relocates + growth resets to a floor and
    // re-blooms (theatre).
    this.state.schemeIndex = mod(this.genome.schemeStart + sectionIndex, SCHEME_FAMILIES.length);
    this.state.center = this.genome.relocateBank[mod(sectionIndex, this.genome.relocateBank.length)];
    this.grownCount = FLOOR_FLORETS;
    this.state.turnSteps = mod(this.state.turnSteps + 1, 34);
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'head scale', min: 0.6, max: 1.7, step: 0.05, default: 1 },
  { id: 'size', label: 'floret size', min: 0.5, max: 2.2, step: 0.05, default: 1 },
];

const g13PhyllotaxisPreset: VisualizerPreset = {
  id: 'g13-phyllotaxis',
  name: 'g13 phyllotaxis',
  params,
  create: () => new PhyllotaxisRenderer(),
};

export default g13PhyllotaxisPreset;
