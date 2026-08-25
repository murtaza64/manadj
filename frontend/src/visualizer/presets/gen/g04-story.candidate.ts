/**
 * "g04 story" (genetic arena g04, THE CENTERPIECE): a preset whose ENTIRE
 * FORM is a narrative arc over each 16-bar section. The human loved how
 * g02-mirror-ladder "tells a story" and asked for a complete 16-bar story.
 * This is abstract theatre — actors are shapes and light, staged in a
 * dark proscenium — following a five-act structure that repeats and
 * transforms every section:
 *
 *   ACT I   bars 1-4   ESTABLISH — one protagonist actor holds the empty
 *                      stage. Sparse world, a single voice.
 *   ACT II  bars 5-8   DEVELOP — a cast enters one actor per bar; motifs
 *                      answer each other (each new actor mirrors the phase
 *                      of the one before, a call-and-response).
 *   ACT III bars 9-12  INTENSIFY — orbital motion, saturation, and scale
 *                      all climb; the actors circle faster and burn hotter.
 *   ACT IV  bars 13-15 BUILD — the cast CONVERGES toward the center and
 *                      the frame tightens; an anticipation glow gathers.
 *   ACT V   bar 16     CLIMAX + RESOLVE — actors collide at center, a white
 *                      resolution shockwave sweeps out, and the world is
 *                      RESEEDED into the next chapter (new palette regime +
 *                      geometry motif per section index — chapters differ).
 *
 * The story SCALES WITH THE MUSIC. Act magnitudes ride a smoothed
 * dynamic-range gate (max of drop excitement and energy): a quiet section
 * tells its story in whispers — few faint actors, slow orbits; a section
 * that goes hard tells it at full volume — the whole cast, fast orbits,
 * saturated color, a hard climax. Never flat.
 *
 * Meter-locked to the bone: acts derive from beat.barIndex anchored at the
 * first downbeat, and every actor's own pulse rides beat.phase / barPhase.
 * Gridless material falls back to an energy-drifted single-actor soliloquy
 * with a bass-pulse heartbeat, so there is always a protagonist.
 *
 * Assigned tech: bar/phrase/section tiers (beat.barIndex) as dramatic
 * structure; energy trend (drop/buildup) as dynamic range; centroid +
 * spread as palette/geometry material; per-band impulses drive actor
 * pulses. Canvas 2D, no GL — narrative clarity over shader flash.
 */

import { energyHue, energyOf } from '../../style';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const BARS_PER_SECTION = 16;
const MAX_ACTORS = 8;
const SHOCKWAVE_LIFE_S = 1.6;

/** Positive modulo — barIndex can be negative before the first downbeat. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Smoothstep 0→1 over [0,1]. */
function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Deterministic per-section chapter hash → [0,1). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A geometry motif: how an actor's body is drawn. Chapters swap motif so
 * successive sections read as visually distinct worlds. */
type Motif = 'ring' | 'blade' | 'lens' | 'shard';

/** A palette regime for a chapter: a base hue rotation and a saturation
 * character, seeded per section so chapters differ but stay in the
 * energy-hue family (color is free to travel; shape carries identity). */
interface Chapter {
  motif: Motif;
  /** Hue offset applied to the whole chapter's energy hue. */
  hueBase: number;
  /** How far actors fan across the hue wheel (palette breadth). */
  hueSpan: number;
  /** Base orbit direction (chapters alternate the world's spin). */
  spin: number;
  /** Base staging radius fraction of the stage. */
  stageR: number;
}

const MOTIFS: Motif[] = ['ring', 'blade', 'lens', 'shard'];

function makeChapter(sectionIndex: number): Chapter {
  const h0 = hash(sectionIndex * 3.0);
  const h1 = hash(sectionIndex * 7.0 + 1.0);
  const h2 = hash(sectionIndex * 11.0 + 2.0);
  return {
    motif: MOTIFS[Math.floor(h0 * MOTIFS.length) % MOTIFS.length],
    hueBase: Math.floor(h1 * 360),
    hueSpan: 40 + h2 * 140,
    spin: h0 < 0.5 ? 1 : -1,
    stageR: 0.24 + h1 * 0.12,
  };
}

class StoryRenderer implements PresetRenderer {
  private prevBar: number | null = null;
  private sectionIndex = 0;
  private chapter: Chapter = makeChapter(0);
  private nextChapter: Chapter = makeChapter(1);
  /** Smoothed dynamic-range gate (0 restrained … 1 maximal). */
  private drama = 0;
  /** Free-running orbit angle (energy-scaled). */
  private orbit = 0;
  /** Gridless drift for the soliloquy fallback. */
  private drift = 0;
  /** Climax resolution shockwave age; < 0 means dead. */
  private shockAge = -1;
  /** Full-field flash envelope (photosensitivity rate-limited). */
  private flash = 0;
  private flashCooldown = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const energy = energyOf(frame.bands);
    const beat = frame.beat;
    const barIndex = beat?.barIndex ?? null;
    const hasGrid = beat !== null && barIndex !== null;

    // --- Dynamic range: the story's volume knob --------------------------
    // Sustained states ride max(drop, energy) so buildups stay alive and a
    // quiet section genuinely whispers. Smoothed so regimes don't flip hard.
    const demand = Math.max(energy, frame.trend.excitement * 0.9 + energy * 0.4);
    this.drama += (Math.min(1, demand) - this.drama) * Math.min(1, frame.dt * 3.5);

    // --- Act structure from the absolute bar index -----------------------
    const barInSection = hasGrid ? mod(barIndex as number, BARS_PER_SECTION) : 0;
    const barPhase = hasGrid ? (beat as { barPhase: number }).barPhase : 0;
    // Continuous position through the section [0,1).
    const sectionPhase = hasGrid ? (barInSection + barPhase) / BARS_PER_SECTION : 0;

    // Section rollover: reseed the chapter (the world transforms).
    if (hasGrid) {
      if (this.prevBar !== null && (barIndex as number) !== this.prevBar) {
        if (mod(barIndex as number, BARS_PER_SECTION) === 0) {
          this.sectionIndex += 1;
          this.chapter = this.nextChapter;
          this.nextChapter = makeChapter(this.sectionIndex + 1);
          this.shockAge = 0;
          this.triggerFlash(0.9 * this.drama);
        } else if (mod(barIndex as number, 4) === 0) {
          // Phrase downbeats get a gentle, rate-limited lift.
          this.triggerFlash(0.4 * this.drama);
        }
      }
      this.prevBar = barIndex;
    } else {
      this.prevBar = null;
      // Gridless soliloquy: one drifting protagonist, bass-pulse heartbeat.
      this.drift += frame.dt * (0.15 + 1.1 * energy);
    }

    // Envelope decays (flash rate-limited to satisfy the photosensitivity
    // floor: at most a few full-field lifts per second, never saturated red).
    this.flash = Math.max(0, this.flash - frame.dt * 2.2);
    this.flashCooldown = Math.max(0, this.flashCooldown - frame.dt);
    if (this.shockAge >= 0) {
      this.shockAge += frame.dt;
      if (this.shockAge > SHOCKWAVE_LIFE_S) this.shockAge = -1;
    }
    this.orbit +=
      this.chapter.spin * frame.dt * (0.12 + 0.9 * energy) * (hasGrid ? 1 : 0.6);

    // --- Act weights: which act are we in, and how strongly --------------
    // Five acts across the 16 bars. Each returns a 0..1 presence weight,
    // cross-faded at the boundaries so the story flows, never cuts.
    const acts = this.actWeights(hasGrid ? barInSection : 0, barPhase, hasGrid);

    // How many actors are on stage: grows through Act II, full cast by the
    // climax, scaled by drama so a quiet section stays sparse.
    const castFull = 1 + Math.round((MAX_ACTORS - 1) * (0.35 + 0.65 * this.drama));
    const cast = hasGrid
      ? Math.max(1, Math.round(1 + (castFull - 1) * acts.developed))
      : 1;

    // Convergence: Act IV drags actors toward center; the climax collapses
    // them fully. 0 = spread on the stage ring, 1 = at center.
    const convergence = Math.min(
      1,
      acts.build * 0.7 + acts.climax * (0.6 + 0.4 * this.drama)
    );

    // Intensity gate: Act III+ heats color/motion.
    const intensity = 0.35 + 0.65 * Math.max(acts.intensify, acts.build, acts.climax);

    // Anticipation glow over the section's last two bars (Act IV tail).
    const anticipation = smoothstep((sectionPhase - 0.8) / 0.2) * (0.4 + 0.6 * this.drama);

    // --- Palette from the current chapter + material cues ----------------
    const chapter = this.chapter;
    const baseHue = energyHue(
      energy,
      chapter.hueBase + frame.time * 5 + (frame.centroid - 0.5) * 70
    );
    // Spread widens the palette fan (a wide sound → a wide chapter palette).
    const hueSpan = chapter.hueSpan * (0.6 + 0.8 * frame.spread);

    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const stageR = unit * chapter.stageR * (frame.params.scale ?? 1);

    // --- Stage floor: dark proscenium, lifted only by the story ----------
    // Floor lightness is deliberately low; flashes are localized-plus-gated.
    const floorLight = 2 + 4 * energy + 8 * this.flash + 5 * anticipation;
    ctx.fillStyle = `hsl(${baseHue}, ${55 + 30 * this.drama}%, ${Math.min(22, floorLight)}%)`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'lighter';

    // A faint stage ring: the world the actors inhabit, brightening as the
    // chapter fills and the anticipation gathers.
    ctx.beginPath();
    ctx.arc(cx, cy, stageR, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${baseHue}, 90%, ${45 + 25 * anticipation}%, ${
      0.1 + 0.25 * this.drama + 0.3 * anticipation
    })`;
    ctx.lineWidth = Math.max(1, unit * 0.0018 * (1 + anticipation));
    ctx.stroke();

    // --- The cast: draw each actor as the chapter's motif ----------------
    const kick = beat ? Math.pow(1 - beat.phase, 2.5) : frame.bands.low * frame.bands.low;
    const intensityParam = frame.params.intensity ?? 1;

    for (let i = 0; i < cast; i++) {
      // Each actor owns a slot on the stage ring. Actors enter in order, so
      // Act II reads as a cast assembling (call-and-response: actor i answers
      // actor i-1 by taking the opposite side of the ring).
      const slot = i / Math.max(1, cast);
      const baseAngle = this.orbit + slot * Math.PI * 2 + (i % 2) * Math.PI;

      // Per-actor pulse: rides the bar so each actor breathes on the meter,
      // phase-shifted so the ensemble answers itself rather than pulsing as
      // one. Impulses (kick/snare) punch the pulse.
      const actorPhase = mod(barPhase + slot, 1);
      const pulse =
        0.5 +
        0.5 * Math.sin(actorPhase * Math.PI * 2) +
        1.4 * kick * (i === 0 ? 1 : 0.5) +
        0.8 * frame.impulse.mid * smoothstep(slot);

      // Radius: spread on the stage ring, dragged to center by convergence.
      const r = stageR * (1 - convergence) * (0.6 + 0.4 * pulse * 0.3);
      const ax = cx + Math.cos(baseAngle) * r;
      const ay = cy + Math.sin(baseAngle) * r;

      // Actor color fans across the chapter palette; the protagonist (i=0)
      // sits at the chapter's home hue.
      const hue = (baseHue + (i / MAX_ACTORS - 0.0) * hueSpan) % 360;
      const light = Math.min(
        88,
        42 + 30 * intensity * pulse + 20 * anticipation + 20 * kick
      );
      const sat = 80 + 20 * this.drama;
      const alpha =
        (0.35 + 0.45 * intensity) *
        (i === 0 ? 1 : 0.55 + 0.45 * acts.developed) *
        intensityParam;

      // Actor scale climbs through the acts (Act III), pumps with its pulse.
      const size =
        unit *
        (0.02 + 0.05 * intensity * this.drama) *
        (0.7 + 0.6 * pulse) *
        (frame.params.scale ?? 1);

      this.drawActor(
        ctx,
        chapter.motif,
        ax,
        ay,
        size,
        baseAngle,
        hue,
        sat,
        light,
        alpha,
        pulse
      );

      // Call-and-response threads: in Act II+, draw a faint chord from this
      // actor to the previous one — the motifs answering each other.
      if (i > 0 && acts.developed > 0.05) {
        const prevSlot = (i - 1) / Math.max(1, cast);
        const prevAngle = this.orbit + prevSlot * Math.PI * 2 + ((i - 1) % 2) * Math.PI;
        const px = cx + Math.cos(prevAngle) * r;
        const py = cy + Math.sin(prevAngle) * r;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(px, py);
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${55 + 25 * anticipation}%, ${
          0.06 + 0.18 * acts.developed + 0.2 * anticipation
        })`;
        ctx.lineWidth = Math.max(0.5, unit * 0.0012 * (1 + pulse));
        ctx.stroke();
      }
    }

    // --- The protagonist core: a stable mass at center, always present ---
    // In Act V the whole cast has converged here; the core pumps with the
    // kick and blazes at the climax.
    const coreSnap = kick + acts.climax * this.drama;
    const coreR = unit * (0.018 + 0.02 * coreSnap + 0.03 * frame.impulse.low + 0.02 * convergence);
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${baseHue}, ${80 + 20 * this.drama}%, ${
      Math.min(85, 50 + 35 * coreSnap)
    }%, ${0.4 + 0.5 * coreSnap})`;
    ctx.fill();

    // --- Act V resolution: a white shockwave sweeping outward ------------
    // The climax that "resolves into the next chapter". Rate-limited via the
    // section rollover; localized ring, decaying — safe under the flash floor.
    if (this.shockAge >= 0) {
      const life = 1 - this.shockAge / SHOCKWAVE_LIFE_S;
      const rr = unit * (0.04 + this.shockAge * 0.85);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      // Tint the resolution toward the INCOMING chapter's home hue: the
      // wave literally carries the new world outward.
      const nextHue = energyHue(energy, this.nextChapter.hueBase);
      ctx.strokeStyle = `hsla(${nextHue}, 90%, ${70 + 20 * life}%, ${life * 0.8 * (0.4 + 0.6 * this.drama)})`;
      ctx.lineWidth = Math.max(2, unit * 0.02 * life);
      ctx.stroke();
    }

    // --- High shimmer: snare/hat powder on the stage ring ----------------
    // MID/HIGH-only (never kick powder), scaled by drama so quiet sections
    // stay clean.
    const shimmer = frame.impulse.high * (0.4 + 0.6 * this.drama);
    if (shimmer > 0.05) {
      const dust = Math.round(2 + 6 * shimmer);
      for (let s = 0; s < dust; s++) {
        const a = this.orbit + Math.random() * Math.PI * 2;
        const rr = stageR + (Math.random() - 0.5) * unit * 0.03;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, Math.max(1, unit * 0.002), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${(baseHue + 40) % 360}, 100%, 80%, ${shimmer * 0.7})`;
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /** Rate-limited full-field flash trigger (photosensitivity floor). */
  private triggerFlash(strength: number): void {
    if (this.flashCooldown > 0) return;
    this.flash = Math.max(this.flash, Math.min(0.9, strength));
    this.flashCooldown = 0.34; // ≤ 3 full-field lifts / second
  }

  /**
   * Cross-faded act presence weights for the given bar-in-section. Returns
   * how "established / developed / intensified / built / climaxed" the scene
   * is right now — each in [0,1], overlapping at the act boundaries so the
   * story flows continuously. Gridless returns a steady soliloquy.
   */
  private actWeights(
    barInSection: number,
    barPhase: number,
    hasGrid: boolean
  ): {
    developed: number;
    intensify: number;
    build: number;
    climax: number;
  } {
    if (!hasGrid) {
      // Soliloquy: a single actor, gently developed, no climax.
      return { developed: 0.15, intensify: 0.2, build: 0, climax: 0 };
    }
    const b = barInSection + barPhase; // 0..16 continuous
    // Act II: bars 4..8 grow the cast (developed 0→1).
    const developed = smoothstep((b - 4) / 4);
    // Act III: bars 8..12 intensify.
    const intensify = smoothstep((b - 8) / 4) * (1 - smoothstep((b - 13) / 2));
    // Act IV: bars 12..15 build/converge.
    const build = smoothstep((b - 12) / 3) * (1 - smoothstep((b - 15) / 1));
    // Act V: bar 15..16 climax.
    const climax = smoothstep((b - 15) / 1);
    return { developed, intensify, build, climax };
  }

  /** Draw one actor in the chapter's geometry motif. */
  private drawActor(
    ctx: CanvasRenderingContext2D,
    motif: Motif,
    x: number,
    y: number,
    size: number,
    angle: number,
    hue: number,
    sat: number,
    light: number,
    alpha: number,
    pulse: number
  ): void {
    const fill = `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
    const glow = `hsla(${hue}, ${sat}%, ${Math.min(95, light + 18)}%, ${alpha * 0.9})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + pulse * 0.4);
    switch (motif) {
      case 'ring': {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.strokeStyle = fill;
        ctx.lineWidth = Math.max(1, size * 0.28 * (0.6 + 0.6 * pulse));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
        break;
      }
      case 'blade': {
        // A thin luminous bar — a spotlight blade.
        const len = size * 2.4;
        const w = Math.max(1, size * 0.35);
        ctx.fillStyle = fill;
        ctx.fillRect(-len / 2, -w / 2, len, w);
        ctx.fillStyle = glow;
        ctx.fillRect(-len / 2, -w / 6, len, w / 3);
        break;
      }
      case 'lens': {
        // A soft filled lozenge (localized lens, not a broad wash).
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 1.4, size * 0.7, 0, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.5, size * 0.28, 0, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
        break;
      }
      case 'shard': {
        // A triangular shard — sharp material for noisy/tonal contrast.
        const s = size * (1 + 0.5 * pulse);
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.86, s * 0.5);
        ctx.lineTo(-s * 0.86, s * 0.5);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = glow;
        ctx.lineWidth = Math.max(1, s * 0.1);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'stage scale', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'intensity', label: 'actor intensity', min: 0.4, max: 2, step: 0.05, default: 1 },
];

const g04StoryPreset: VisualizerPreset = {
  id: 'g04-story',
  name: 'g04 story',
  params,
  create: () => new StoryRenderer(),
};

export default g04StoryPreset;
