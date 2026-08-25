/**
 * "g10 iris-flat" (genetic arena g10, FLAT wave, NOVEL; Vissonance 'Iris'
 * tradition): a radial iris of 24 SOLID matte wedge petals — one per spectrum
 * band, frequency-ordered around the circle. Each petal's LENGTH is its band
 * level (bandsSlow for the resting motion, instantaneous spectrum only for the
 * kick pop). Color comes from a committed FLAT 4-color scheme (cream / coral /
 * teal / ink); the whole scheme hard-swaps per section.
 *
 * FLAT LAW: solid matte fills, hard edges, a committed palette, NO
 * glow/bloom/additive haze/feedback smear/noise/particles. All motion is
 * TRANSFORMS (aperture scale, petal-count regroup, rotation) and COLOR SWAPS,
 * cleanly eased or hard-cut on the grid. Dark FLAT background (a scheme tone),
 * not black-void-with-glow. `source-over` only, no `lighter`, no shadowBlur.
 *
 * Metric grammar:
 *   KICK   — the iris APERTURE pops open one ring step (transform) and snaps
 *            back. Solid, gated on impulse.low. No flash.
 *   SNARE  — alternating petals flip to the scheme's ACCENT color for one beat
 *            (mid/high impulse). A clean color swap, not a glint.
 *   PHRASE — petal grouping re-arranges (hard cut): bands fold into
 *            24 / 12 / 8 / 6 grouped wedges, cycling per phrase.
 *   SECTION— the whole 4-color scheme hard-swaps (a chroma event; photosafe,
 *            no full-field luminance flash — background changes tone, petals
 *            recolor, but mean luminance stays comparable across schemes).
 *   DROP   — petals extend to full radius and the scheme INVERTS (background
 *            <-> petal fill) for the plateau; rides max(drop, energy) so it
 *            holds. A clean geometric + palette state, not a strobe.
 *   BUILDUP— the iris slowly CONTRACTS (aperture shrinks): tension by geometry,
 *            not by dimming. Tense but alive.
 *
 * Assigned tech: 24-band spectrum (primary) + bandsSlow motion; per-band
 * impulses (kick aperture / snare accent); ladder tiers (phrase regroup,
 * section scheme swap); trend drop/buildup split; trackId genome (scheme
 * order). Canvas 2D — crisp fills.
 */

import { energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const BAND_COUNT = 24;
const PHRASE_BARS = 4;
const SECTION_BARS = 16;
/** How many grouped wedges each phrase layout uses (all divide 24). */
const GROUP_CYCLE = [24, 12, 8, 6];
/** Discrete aperture ring steps the kick pops through. */
const RING_STEP = 0.14;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same scheme order. */
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

/** A committed flat scheme: [background, petalA, petalB, accent]. Matte,
 * bright, saturated (per project taste), comparable mean luminance so section
 * swaps are chroma events, not luminance flashes. */
interface FlatScheme {
  bg: string;
  a: string;
  b: string;
  accent: string;
}

/** Hand-picked flat schemes in the Vissonance / committed-palette spirit:
 * a dark-but-not-black background tone paired with two petal tones and one
 * hot accent. Kept to 4 committed colors each. */
const SCHEMES: FlatScheme[] = [
  // cream / coral / teal / ink (the brief's reference)
  { bg: '#182029', a: '#ff5e57', b: '#17c3b2', accent: '#ffcf56' },
  // deep plum / magenta / lime / gold
  { bg: '#20132b', a: '#ff2e88', b: '#8be02a', accent: '#ffd23f' },
  // navy / cyan / orange / white-cream
  { bg: '#0f1b2d', a: '#00c2ff', b: '#ff7a1a', accent: '#f5efe0' },
  // forest ink / chartreuse / red / bone
  { bg: '#141e14', a: '#c6ff3a', b: '#ff3b30', accent: '#e8e2cf' },
  // maroon / peach / teal / sky
  { bg: '#25121a', a: '#ff9d76', b: '#1fb6a0', accent: '#7ad0ff' },
  // slate indigo / violet / amber / mint
  { bg: '#171628', a: '#8a5cff', b: '#ffb000', accent: '#4be6a0' },
];

class IrisFlatRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;

  /** genome: the order sections walk through the scheme table. */
  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  /** which scheme is currently painted (section-owned). */
  private schemeIndex = 0;
  /** phrase-owned grouping: how many grouped wedges. */
  private groupCount = 24;
  /** snare accent flip: which parity is accented (0 = none). */
  private accentParity = 0;

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;

  /** aperture ring: eased current + target (kick pops target up one step). */
  private aperture = 0.5;
  private apertureTarget = 0.5;
  /** snare accent envelope (decays over one beat). */
  private accentEnv = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  /** slow continuous rotation of the whole iris (bandsSlow-driven). */
  private spin = 0;
  /** gridless pseudo-beat clock. */
  private pseudoBeat = 0;

  private reseed(key: number): void {
    const r = splitmix(key);
    const order = SCHEMES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    this.schemeOrder = order;
    this.schemeIndex = order[0];
    this.groupCount = GROUP_CYCLE[0];
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

    // --- Identity / genome --------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (
      this.lastTrackId === null &&
      trackId === null &&
      this.prevBar === null
    ) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }

    // --- Regime split (smoothed ~0.35 s; ride max(drop, energy)) -----------
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

    // --- Metric tiers (ladder-correct) -------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;

    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatInBar = beat!.beatInBar;
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex);
        this.prevBar = barIndex;
      }
      // Snare accent on the backbeat (beats 1 & 3 of a 4-beat bar) when a
      // mid/high transient lands: a one-beat color flip.
      if (this.prevBeatInBar === null || beatInBar !== this.prevBeatInBar) {
        const snare = frame.impulse.mid * 0.7 + frame.impulse.high * 0.3;
        const backbeat = mod(beatInBar, 2) === 1;
        if (backbeat && snare > 0.05) {
          this.accentParity = this.accentParity === 1 ? 2 : 1;
          this.accentEnv = 1;
        }
        this.prevBeatInBar = beatInBar;
      }
    } else {
      // Gridless pseudo-meter: keep bars/phrases/sections cutting on a clock.
      this.pseudoBeat += dt * (0.6 + 2.0 * energy);
      const pBar = Math.floor(this.pseudoBeat / 4);
      if (this.prevBar === null || pBar !== this.prevBar) {
        this.onBarCut(pBar);
        this.prevBar = pBar;
      }
    }

    // --- Kick aperture pop (transform, gated on low impulse) ---------------
    if (frame.impulse.low > 0.18) {
      // pop open one ring step then snap back (target relaxes below).
      this.apertureTarget = clamp01(this.baseAperture(buildup) + RING_STEP);
    } else {
      this.apertureTarget = this.baseAperture(buildup);
    }
    // ease aperture toward target: fast attack (pop), slower release (snap).
    const apAlpha = 1 - Math.exp(-dt / (this.aperture < this.apertureTarget ? 0.04 : 0.16));
    this.aperture += (this.apertureTarget - this.aperture) * apAlpha;

    // accent envelope decays over ~one beat's worth (~0.4 s).
    this.accentEnv = Math.max(0, this.accentEnv - dt / 0.4);
    if (this.accentEnv <= 0) this.accentParity = 0;

    // --- Slow whole-iris rotation (bandsSlow drives the RATE) --------------
    this.spin += dt * (0.05 + 0.35 * bandsSlow.mid + 0.25 * drive);

    // --- Draw ---------------------------------------------------------------
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    // Drop inverts background <-> petals for the plateau (hard state, held).
    const inverted = dropOn;
    const bg = inverted ? scheme.a : scheme.bg;
    const petalMain = inverted ? scheme.bg : scheme.a;
    const petalAlt = inverted ? scheme.accent : scheme.b;
    const accentCol = inverted ? scheme.b : scheme.accent;

    // Flat matte background — no gradient, no glow.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scaleParam = frame.params.scale ?? 1;
    const petalGain = frame.params.petalGain ?? 1;
    const gap = frame.params.gap ?? 0.12;

    const maxR = unit * 0.46 * scaleParam;
    // Inner aperture radius: kick pops it, buildup contracts it.
    const innerR = unit * (0.05 + 0.16 * this.aperture) * scaleParam;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.spin);

    const groups = this.groupCount;
    const bandsPerGroup = BAND_COUNT / groups;
    const wedge = (Math.PI * 2) / groups;
    const halfGap = wedge * clamp01(gap) * 0.5;

    for (let gi = 0; gi < groups; gi++) {
      // Group level: mean of member bands. Motion rides bandsSlow via the
      // spectrum's own smoothing; the kick POP uses instantaneous spectrum.
      let slowSum = 0;
      let fastSum = 0;
      for (let k = 0; k < bandsPerGroup; k++) {
        const bandIdx = gi * bandsPerGroup + k;
        const s = frame.spectrum[bandIdx] ?? 0;
        // approximate a slow level from the fast spectrum + drive envelope so
        // resting motion is smooth even when bandsSlow is 3-band only.
        slowSum += s;
        fastSum += s;
      }
      const slowLevel = clamp01((slowSum / bandsPerGroup) * petalGain);
      const fastLevel = clamp01((fastSum / bandsPerGroup) * petalGain);
      // Resting length rides the smoothed level; kick pop adds a touch of the
      // instantaneous on top (bounded).
      const restLen = slowLevel;
      const popLen = restLen + 0.12 * frame.impulse.low * (fastLevel);
      // Drop extends petals to (near) full radius, held across plateau.
      const lenNorm = inverted
        ? Math.max(popLen, 0.7 + 0.3 * drive)
        : clamp01(popLen);

      const outerR = innerR + (maxR - innerR) * lenNorm;
      if (outerR <= innerR + 0.5) continue;

      const a0 = gi * wedge + halfGap;
      const a1 = (gi + 1) * wedge - halfGap;

      // Petal color: alternating A / B; snare flips one parity to accent.
      const parity = mod(gi, 2) + 1;
      const accented = this.accentParity !== 0 && parity === this.accentParity;
      let fill: string;
      if (accented) {
        fill = accentCol;
      } else {
        fill = parity === 1 ? petalMain : petalAlt;
      }

      // Solid matte annular wedge — hard edges, single flat fill.
      ctx.beginPath();
      ctx.arc(0, 0, innerR, a0, a1, false);
      ctx.arc(0, 0, outerR, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    // Center hub: a solid flat disc in the accent tone (anchors the iris,
    // pulses size on the beat via a crisp transform — no glow).
    const beatPulse = beat ? 0.5 + 0.5 * smoothstep(1 - beat.phase) : 0.5;
    const hubR = innerR * (0.82 + 0.18 * beatPulse);
    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fillStyle = inverted ? scheme.a : scheme.accent;
    ctx.fill();

    ctx.restore();
  }

  /** Resting aperture: contracts under buildup (tension by geometry). */
  private baseAperture(buildup: number): number {
    return clamp01(0.55 - 0.35 * buildup);
  }

  // --- Boundary cuts ------------------------------------------------------

  private onBarCut(barIndex: number): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isPhrase) {
      const phraseIndex = Math.floor(barIndex / PHRASE_BARS);
      this.groupCount = GROUP_CYCLE[mod(phraseIndex, GROUP_CYCLE.length)];
    }
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'iris scale', min: 0.6, max: 1.4, step: 0.05, default: 1 },
  { id: 'petalGain', label: 'petal length', min: 0.6, max: 2, step: 0.05, default: 1.15 },
  { id: 'gap', label: 'petal gap', min: 0, max: 0.4, step: 0.02, default: 0.14 },
];

const g10IrisFlatPreset: VisualizerPreset = {
  id: 'g10-iris-flat',
  name: 'g10 iris-flat',
  params,
  create: () => new IrisFlatRenderer(),
};

export default g10IrisFlatPreset;
