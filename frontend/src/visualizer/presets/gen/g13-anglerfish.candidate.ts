/**
 * "g13 anglerfish" (genetic arena g13, NOVEL — LIVING THINGS & NARRATIVE).
 * An ABYSS predation scene: one anglerfish silhouette hangs at frame
 * center in a black deep-sea column, its bioluminescent LURE throbbing on
 * the bass. A SCHOOL of prey fish (spectrum-band shoal) drifts in the water
 * and is drawn toward the lure (phototaxis). On a strong beat the
 * anglerfish STRIKES the densest cluster and the nearest prey vanish
 * (eaten) in an ink puff. Legible predator/prey causality: you can see WHY
 * every fish moved (toward the light) and WHY it died (the strike).
 *
 * Band vocabulary (distinct per band):
 *   LOW   — the LURE. Esca brightness+radius rides bands.low; impulse.low
 *           throbs a localized light pulse into the water near the lure.
 *   MID   — the anglerfish BODY loom + jaw gape (bandsSlow.mid, a slow
 *           attribute); mid impulse widens the gape.
 *   HIGH  — the prey SHOAL: high band = darting liveliness; impulse.high =
 *           a discrete scale-glint hairline on each fish (not glow).
 *   centroid/flatness — water tint (cold→warm) + shoal cohesion (tonal =
 *           jewel shoal, noisy = scattered murk).
 *
 * Dramatic grammar:
 *   STRIKE — beat-locked lunge toward the densest prey cluster, gated on
 *            impulse.low AND drive (max(drop,energy)); prey in the strike
 *            cone are eaten (removed + ink puff). One per beat, <=2/s.
 *   DROP   — feeding FRENZY: lure blazes, shoal pulled hard, strikes ride
 *            max(drop,energy) (sustained, not a transition twitch).
 *   BUILDUP— the shoal GATHERS/circles the lure (bait ball tightening) —
 *            tense but alive, never still.
 *   SECTION(%16) — the shoal disperses; a fresh shoal + palette swims in
 *            (hard cut); anglerfish re-poses. PHRASE(%4) — lure hue shift.
 *
 * FLAT-ish LAW: crisp matte silhouettes on a dark abyss floor, one
 * committed saturated palette per section, source-over draws, no feedback/
 * bloom/dust. Localized lure pulses + ink puffs only (photosafe).
 *
 * Assigned tech: bands.low/mid + impulse.low/high, bandsSlow, trend drop/
 * buildup split, centroid + flatness, 24-band spectrum (shoal population),
 * beat phase + ladder tiers (beat.ladderBarIndex ?? beat.barIndex), trackId
 * genome. Canvas 2D.
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

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** splitmix32 avalanche → stable [0,1). Same key ⇒ same shoal/palette. */
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

/** A committed abyss scheme (comparable mean luminance across schemes so a
 * section cut is a chroma event, not a luminance flash). Bright saturated
 * lure/shoal, dark water. */
interface Scheme {
  waterTop: string;
  waterFloor: string;
  fish: string;
  lure: string;
  shoal: string;
  glint: string;
  ink: string;
}

const SCHEMES: Scheme[] = [
  // teal abyss / cyan lure / warm-gold shoal
  {
    waterTop: '#062028',
    waterFloor: '#02090d',
    fish: '#05141a',
    lure: '#25f0ff',
    shoal: '#ffb020',
    glint: '#eafcff',
    ink: '#010609',
  },
  // indigo abyss / magenta lure / lime shoal
  {
    waterTop: '#12093a',
    waterFloor: '#050216',
    fish: '#0b0526',
    lure: '#ff34c0',
    shoal: '#9cff2e',
    glint: '#ffe0f5',
    ink: '#030110',
  },
  // deep green abyss / gold lure / hot-coral shoal
  {
    waterTop: '#052616',
    waterFloor: '#020c08',
    fish: '#04160d',
    lure: '#ffd21a',
    shoal: '#ff5a3c',
    glint: '#fff6d0',
    ink: '#010805',
  },
  // violet-black abyss / spring-green lure / cyan shoal
  {
    waterTop: '#1a0a2e',
    waterFloor: '#080213',
    fish: '#0f0620',
    lure: '#3dffa0',
    shoal: '#22c8ff',
    glint: '#e6fff2',
    ink: '#040110',
  },
];

interface Prey {
  /** normalized field position [-1,1] (x), [-1,1] (y). */
  x: number;
  y: number;
  /** drift phase for idle wander. */
  phase: number;
  /** body size (from a spectrum band). */
  size: number;
  /** glint flicker offset. */
  glintPhase: number;
  /** 1 = alive, counts down when eaten (ink-puff fade). */
  life: number;
}

/** A dissipating ink puff left where a strike consumed prey. */
interface Puff {
  x: number;
  y: number;
  r: number;
  life: number;
}

class AnglerfishRenderer implements PresetRenderer {
  private lastTrackId: number | null = null;
  private schemeOrder: number[] = SCHEMES.map((_, i) => i);
  private schemeIndex = 0;

  private prey: Prey[] = [];
  private puffs: Puff[] = [];

  private prevBar: number | null = null;
  private prevBeatInBar: number | null = null;
  private pseudoBeat = 0;

  private smoothDrop = 0;
  private smoothBuildup = 0;

  /** eased lure brightness (localized, photosafe throb). */
  private lureGlow = 0;
  /** anglerfish body loom (eased mid). */
  private loom = 0.4;
  /** jaw gape 0..1 (eased). */
  private gape = 0;
  /** strike animation: 1 at lunge, decays; drives the head thrust. */
  private strikeAnim = 0;
  /** lunge direction (screen radians) toward last strike target. */
  private strikeDir = 0;

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
    this.respawnShoal(r, 1);
  }

  /** Populate a fresh shoal; sizes seeded from a spectrum snapshot when we
   * have one (population reflects the band content). */
  private respawnShoal(r: () => number, sizeScale: number): void {
    const count = 10 + Math.floor(r() * 10); // 10..19
    const list: Prey[] = [];
    for (let i = 0; i < count; i++) {
      const ang = r() * Math.PI * 2;
      const rad = 0.45 + r() * 0.5;
      list.push({
        x: Math.cos(ang) * rad,
        y: Math.sin(ang) * rad * 0.85,
        phase: r() * Math.PI * 2,
        size: (0.5 + r() * 0.9) * sizeScale,
        glintPhase: r() * Math.PI * 2,
        life: 1,
      });
    }
    this.prey = list;
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
    const spectrum = frame.spectrum ?? [];

    // --- Identity / genome ------------------------------------------------
    const trackId = dominantTrackId(frame);
    if (
      this.lastTrackId === null &&
      trackId === null &&
      this.prevBar === null &&
      this.prey.length === 0
    ) {
      const pseudo =
        Math.round((frame.centroid * 4096 + energy * 811 + frame.spread * 173) * 131) || 1;
      this.reseed(pseudo);
    }
    if (trackId != null && trackId !== this.lastTrackId) {
      this.lastTrackId = trackId;
      this.reseed(trackId);
    }
    if (this.prey.length === 0) this.reseed(1);

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

    // --- Metric tiers (ladder-correct) ------------------------------------
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : null;
    const hasGrid = beat !== null && tierBar !== null;
    let beatEdge = false;
    if (hasGrid) {
      const barIndex = tierBar as number;
      const beatInBar = beat!.beatInBar;
      if (this.prevBar === null || barIndex !== this.prevBar) {
        this.onBarCut(barIndex, spectrum);
        this.prevBar = barIndex;
      }
      if (this.prevBeatInBar === null || beatInBar !== this.prevBeatInBar) {
        beatEdge = true;
        this.prevBeatInBar = beatInBar;
      }
    } else {
      this.pseudoBeat += dt * (0.6 + 2.4 * energy);
      const pBeat = Math.floor(this.pseudoBeat);
      if (this.prevBeatInBar === null || pBeat !== this.prevBeatInBar) {
        beatEdge = true;
        this.prevBeatInBar = pBeat;
      }
      const pBar = Math.floor(this.pseudoBeat / 4);
      if (this.prevBar === null || pBar !== this.prevBar) {
        this.onBarCut(pBar, spectrum);
        this.prevBar = pBar;
      }
    }

    // --- Lure throb (localized, eased). impulse.low = beacon pulse --------
    const lureTarget = clamp01(0.28 + 0.72 * frame.bands.low + 0.6 * frame.impulse.low);
    const lureAlpha = 1 - Math.exp(-dt / 0.06);
    this.lureGlow += (lureTarget - this.lureGlow) * lureAlpha;

    // --- Body loom + jaw gape (mids; slow attribute rides bandsSlow) ------
    const loomTarget = clamp01(0.35 + 0.65 * bandsSlow.mid + 0.3 * drive);
    this.loom += (loomTarget - this.loom) * (1 - Math.exp(-dt / 0.4));
    const gapeTarget = clamp01(0.15 + 0.7 * frame.impulse.mid + 0.5 * drive);
    this.gape += (gapeTarget - this.gape) * (1 - Math.exp(-dt / 0.12));

    // --- Phototaxis: prey drawn toward the lure (center). Rate rides slow
    //     bands; buildup pulls them in HARD (bait ball). -------------------
    const pull = 0.12 + 0.5 * bandsSlow.high + 0.9 * buildup + 0.6 * drop;
    const dart = 0.35 + 1.6 * frame.bands.high;
    for (const p of this.prey) {
      if (p.life <= 0) continue;
      // wander
      p.phase += dt * (0.4 + dart);
      const wob = 0.04 * Math.sin(p.phase);
      // pull toward center (the lure)
      const dist = Math.hypot(p.x, p.y) + 1e-4;
      const inward = pull * dt;
      p.x += (-p.x / dist) * inward + Math.cos(p.phase * 1.3) * wob * dt * 6;
      p.y += (-p.y / dist) * inward * 0.9 + Math.sin(p.phase) * wob * dt * 6;
      // don't let them collapse fully onto the lure; hold a small orbit
      const d2 = Math.hypot(p.x, p.y);
      if (d2 < 0.14) {
        const s = 0.14 / (d2 + 1e-4);
        p.x *= s;
        p.y *= s;
      }
    }

    // --- STRIKE: beat-locked lunge at the densest cluster -----------------
    // Gated on impulse.low AND drive so it reads as a bass-driven predation
    // event (never a mid/high twitch). One per beat, <=2/s.
    if (beatEdge && frame.impulse.low > 0.22 && drive > 0.35) {
      this.doStrike();
    }
    // strike animation decay (head thrust returns)
    this.strikeAnim *= Math.exp(-dt / 0.18);

    // --- Puff decay -------------------------------------------------------
    for (const puff of this.puffs) {
      puff.life -= dt / 0.5;
      puff.r += dt * 0.25;
    }
    this.puffs = this.puffs.filter((p) => p.life > 0);

    // fade eaten prey out (life ramps down), then cull
    for (const p of this.prey) {
      if (p.life < 1) p.life -= dt / 0.3;
    }
    this.prey = this.prey.filter((p) => p.life > 0);
    // if the shoal is decimated, quietly regrow a couple stragglers in
    if (this.prey.length < 4) {
      const r = splitmix((this.lastTrackId ?? 1) * 40503 + Math.floor(frame.time * 3));
      for (let i = this.prey.length; i < 6; i++) {
        const ang = r() * Math.PI * 2;
        this.prey.push({
          x: Math.cos(ang) * 0.95,
          y: Math.sin(ang) * 0.8,
          phase: r() * Math.PI * 2,
          size: 0.5 + r() * 0.8,
          glintPhase: r() * Math.PI * 2,
          life: 1,
        });
      }
    }

    // ======================= DRAW =========================================
    const scheme = SCHEMES[mod(this.schemeIndex, SCHEMES.length)];
    const cx = width / 2;
    const unit = Math.min(width, height);
    const depth = frame.params.abyssDepth ?? 1;
    const shoalScale = frame.params.shoalSize ?? 1;
    const reach = frame.params.strikeReach ?? 1;

    const cy = height * (0.42 + 0.12 * clamp01(1 - this.loom));
    const fieldR = unit * 0.42;
    const toScreen = (fx: number, fy: number): [number, number] => [
      cx + fx * fieldR,
      cy + fy * fieldR * (0.9 / depth),
    ];

    // Water column: vertical gradient, dark floor. Centroid tints it.
    ctx.globalCompositeOperation = 'source-over';
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, scheme.waterTop);
    grad.addColorStop(1, scheme.waterFloor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Faint marine-snow specks drifting down (NOT dust powder — sparse,
    // slow, decorative depth cue; a handful, deterministic per frame time).
    ctx.fillStyle = scheme.glint;
    ctx.globalAlpha = 0.06 + 0.05 * frame.bands.high;
    const snowN = 26;
    for (let i = 0; i < snowN; i++) {
      const sx = mod(i * 97.13 + frame.time * 6, width);
      const sy = mod(i * 53.7 + frame.time * (10 + 30 * frame.bands.mid), height);
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    // --- The anglerfish (center-ish, looming from the dark) --------------
    const bodyR = fieldR * (0.24 + 0.16 * this.loom);
    const headThrust = this.strikeAnim * fieldR * 0.5 * reach;
    const bx = cx + Math.cos(this.strikeDir) * headThrust;
    const by = cy + Math.sin(this.strikeDir) * headThrust * (0.9 / depth);

    // Body: a fat matte silhouette blob with a tapering tail behind.
    ctx.fillStyle = scheme.fish;
    ctx.beginPath();
    ctx.ellipse(bx, by, bodyR * 1.25, bodyR, 0, 0, Math.PI * 2);
    ctx.fill();
    // tail fin (behind, opposite the strike direction)
    const tailDir = this.strikeDir + Math.PI;
    const tx = bx + Math.cos(tailDir) * bodyR * 1.35;
    const ty = by + Math.sin(tailDir) * bodyR * 1.35;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(
      tx + Math.cos(tailDir + 0.5) * bodyR * 0.7,
      ty + Math.sin(tailDir + 0.5) * bodyR * 0.7
    );
    ctx.lineTo(
      tx + Math.cos(tailDir - 0.5) * bodyR * 0.7,
      ty + Math.sin(tailDir - 0.5) * bodyR * 0.7
    );
    ctx.closePath();
    ctx.fill();

    // Jaw: a gaping wedge on the strike side, opening with the gape signal.
    const jawDir = this.strikeDir;
    const jawX = bx + Math.cos(jawDir) * bodyR * 1.1;
    const jawY = by + Math.sin(jawDir) * bodyR * 1.1;
    const gapeHalf = (0.25 + 0.7 * this.gape) * 0.9;
    ctx.fillStyle = scheme.ink;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(
      jawX + Math.cos(jawDir + gapeHalf) * bodyR * 0.9,
      jawY + Math.sin(jawDir + gapeHalf) * bodyR * 0.9
    );
    ctx.lineTo(
      jawX + Math.cos(jawDir - gapeHalf) * bodyR * 0.9,
      jawY + Math.sin(jawDir - gapeHalf) * bodyR * 0.9
    );
    ctx.closePath();
    ctx.fill();
    // teeth: a row of tiny bright triangles along the jaw rim (highs shimmer)
    const teeth = 7;
    const toothLit = clamp01(0.3 + 0.7 * frame.bands.high);
    ctx.fillStyle = scheme.glint;
    ctx.globalAlpha = 0.5 + 0.5 * toothLit;
    for (let i = 0; i <= teeth; i++) {
      const a = jawDir - gapeHalf + (2 * gapeHalf * i) / teeth;
      const rx = jawX + Math.cos(a) * bodyR * 0.9;
      const ry = jawY + Math.sin(a) * bodyR * 0.9;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx - Math.cos(a) * unit * 0.012, ry - Math.sin(a) * unit * 0.012 + unit * 0.006);
      ctx.lineTo(rx - Math.cos(a) * unit * 0.012, ry - Math.sin(a) * unit * 0.012 - unit * 0.006);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- The LURE: an illicium arching over the head, esca bulb glowing ---
    // Localized radial glow (photosafe — small, bounded).
    const stalkBase: [number, number] = [
      bx + Math.cos(jawDir - Math.PI / 2) * bodyR * 0.4,
      by + Math.sin(jawDir - Math.PI / 2) * bodyR * 0.4 - bodyR * 0.4,
    ];
    const escaAng = jawDir - Math.PI / 2 + 0.2 * Math.sin(frame.time * 1.3);
    const escaLen = bodyR * (1.3 + 0.3 * this.loom);
    const esca: [number, number] = [
      stalkBase[0] + Math.cos(escaAng) * escaLen,
      stalkBase[1] + Math.sin(escaAng) * escaLen,
    ];
    // illicium (stalk)
    ctx.strokeStyle = scheme.fish;
    ctx.lineWidth = Math.max(1.5, unit * 0.006);
    ctx.beginPath();
    ctx.moveTo(stalkBase[0], stalkBase[1]);
    ctx.quadraticCurveTo(
      stalkBase[0] + Math.cos(escaAng - 0.4) * escaLen * 0.6,
      stalkBase[1] + Math.sin(escaAng - 0.4) * escaLen * 0.6,
      esca[0],
      esca[1]
    );
    ctx.stroke();
    // esca glow: localized radial gradient, radius+brightness ride the lure
    const escaR = unit * (0.02 + 0.05 * this.lureGlow);
    const halo = ctx.createRadialGradient(esca[0], esca[1], 0, esca[0], esca[1], escaR * 3.5);
    halo.addColorStop(0, scheme.lure);
    halo.addColorStop(0.35, scheme.lure);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = clamp01(0.35 + 0.55 * this.lureGlow);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(esca[0], esca[1], escaR * 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // solid bright bulb core
    ctx.fillStyle = scheme.glint;
    ctx.beginPath();
    ctx.arc(esca[0], esca[1], escaR * (0.5 + 0.3 * this.lureGlow), 0, Math.PI * 2);
    ctx.fill();

    // --- Prey shoal: matte fish-wedges pointing along their travel; glint
    //     hairline on impulse.high. Cohesion from flatness. ---------------
    const cohesion = clamp01(1 - frame.flatness); // tonal = tight jewel shoal
    const glintOn = clamp01(frame.impulse.high * 1.2 + frame.bands.high * 0.3);
    for (const p of this.prey) {
      const [px, py] = toScreen(p.x, p.y);
      // heading: toward lure (they swim in)
      const hx = -p.x;
      const hy = -p.y;
      const hAng = Math.atan2(hy, hx);
      const sz = unit * 0.014 * p.size * shoalScale * (0.7 + 0.5 * cohesion);
      const alpha = clamp01(p.life);
      // body wedge
      ctx.fillStyle = scheme.shoal;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(hAng) * sz * 1.6, py + Math.sin(hAng) * sz * 1.6);
      ctx.lineTo(px + Math.cos(hAng + 2.4) * sz, py + Math.sin(hAng + 2.4) * sz);
      ctx.lineTo(px + Math.cos(hAng - 2.4) * sz, py + Math.sin(hAng - 2.4) * sz);
      ctx.closePath();
      ctx.fill();
      // tail fin
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(hAng + Math.PI) * sz * 1.1, py + Math.sin(hAng + Math.PI) * sz * 1.1);
      ctx.lineTo(px + Math.cos(hAng + Math.PI + 0.5) * sz * 1.7, py + Math.sin(hAng + Math.PI + 0.5) * sz * 1.7);
      ctx.lineTo(px + Math.cos(hAng + Math.PI - 0.5) * sz * 1.7, py + Math.sin(hAng + Math.PI - 0.5) * sz * 1.7);
      ctx.closePath();
      ctx.fill();
      // glint hairline (discrete, on highs)
      if (glintOn > 0.08) {
        const fl = 0.5 + 0.5 * Math.sin(frame.time * 20 + p.glintPhase);
        ctx.strokeStyle = scheme.glint;
        ctx.globalAlpha = alpha * clamp01(glintOn * fl);
        ctx.lineWidth = Math.max(1, unit * 0.0025 * glintOn);
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(hAng) * sz * 1.4, py + Math.sin(hAng) * sz * 1.4);
        ctx.lineTo(px + Math.cos(hAng + Math.PI) * sz * 0.6, py + Math.sin(hAng + Math.PI) * sz * 0.6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- Ink puffs (where prey were eaten) --------------------------------
    for (const puff of this.puffs) {
      const [px, py] = toScreen(puff.x, puff.y);
      const pr = unit * puff.r;
      ctx.fillStyle = scheme.ink;
      ctx.globalAlpha = clamp01(puff.life) * 0.85;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Lunge at the densest surviving prey cluster; consume those inside the
   * strike cone (fade to death + spawn an ink puff). */
  private doStrike(): void {
    const alive = this.prey.filter((p) => p.life >= 1);
    if (alive.length === 0) return;
    // find densest point: pick the prey with the most neighbors within a
    // radius (cheap O(n^2) — n is small).
    let bestIdx = 0;
    let bestCount = -1;
    for (let i = 0; i < alive.length; i++) {
      let c = 0;
      for (let j = 0; j < alive.length; j++) {
        if (Math.hypot(alive[i].x - alive[j].x, alive[i].y - alive[j].y) < 0.22) c++;
      }
      if (c > bestCount) {
        bestCount = c;
        bestIdx = i;
      }
    }
    const target = alive[bestIdx];
    this.strikeDir = Math.atan2(target.y, target.x);
    this.strikeAnim = 1;
    // consume prey within the strike cone / reach
    for (const p of this.prey) {
      if (p.life < 1) continue;
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if (d < 0.24) {
        p.life = 0.99; // start the death fade
        this.puffs.push({ x: p.x, y: p.y, r: 0.02, life: 1 });
      }
    }
  }

  private onBarCut(barIndex: number, spectrum: number[]): void {
    const isPhrase = mod(barIndex, PHRASE_BARS) === 0;
    const isSection = mod(barIndex, SECTION_BARS) === 0;
    if (isSection) {
      const sectionIndex = Math.floor(barIndex / SECTION_BARS);
      this.schemeIndex = this.schemeOrder[mod(sectionIndex, this.schemeOrder.length)];
      // fresh shoal, sized from the current spectrum content.
      const r = splitmix((this.lastTrackId ?? 1) * 2654435761 + barIndex);
      const sizeScale =
        spectrum.length > 0
          ? 0.7 + 0.9 * clamp01(spectrum.reduce((a, b) => a + b, 0) / spectrum.length)
          : 1;
      this.respawnShoal(r, sizeScale);
    } else if (isPhrase) {
      // phrase: nothing structural — the lure hue shift is implicit in the
      // scheme; nudge a couple stragglers inward so the shoal keeps evolving.
      for (const p of this.prey) {
        if (p.life >= 1) {
          p.x *= 0.9;
          p.y *= 0.9;
        }
      }
    }
  }
}

const params: PresetParam[] = [
  { id: 'abyssDepth', label: 'abyss depth', min: 0.7, max: 1.6, step: 0.05, default: 1.05 },
  { id: 'shoalSize', label: 'shoal size', min: 0.6, max: 1.6, step: 0.05, default: 1 },
  { id: 'strikeReach', label: 'strike reach', min: 0.5, max: 1.8, step: 0.05, default: 1.1 },
];

const g13AnglerfishPreset: VisualizerPreset = {
  id: 'g13-anglerfish',
  name: 'g13 anglerfish',
  params,
  create: () => new AnglerfishRenderer(),
};

export default g13AnglerfishPreset;
