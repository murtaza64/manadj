/**
 * "g03 analyzer-cathedral" (genetic arena g03, NOVEL): the spectrum analyzer
 * as ARCHITECTURE, carrying the mirror-ladder energy the human loves — a
 * classic visualizer form (24-band bars) fused with our full metric/EQ/beat
 * tech. The 24 bands become monumental glowing glass columns stood up in a
 * shallow arc across a dark reflecting floor, rendered with fake-3D depth
 * (perspective foreshortening, floor reflections, bloom).
 *
 * Every element answers to something musical:
 *
 *   spectrum   → 24 columns, punchy ballistics (near-instant rise, fast but
 *                musical fall) with floating PEAK SHARDS (light caps that
 *                hold then free-fall, Winamp gravity);
 *   deck EQ    → the colonnade is sectioned into low / mid / high REGISTER
 *                GROUPS; each group's brightness/height rides its deck EQ
 *                knob, and a KILL (knob → 0) COLLAPSES its group (columns
 *                sink into the floor);
 *   beat       → floor SHOCKWAVE rings ripple outward from the base on every
 *                beat, lighting the columns they pass;
 *   per bar    → the whole ring QUARTER-TURNS (0°→90°→180°→270°), the
 *                colonnade tumbling around its center once per 4 bars;
 *   phrase     → the arrangement RE-RACKS between three racks — arc ↔ full
 *                ring ↔ straight line — one per 4-bar phrase, plus an
 *                anticipation glow building over the phrase's last bar;
 *   section    → the hall INVERTS: floor becomes ceiling (reflection flips
 *                above), and the palette regime swaps warm↔cool.
 *
 * Tiers derive from beat.barIndex anchored at the first downbeat (the
 * four-on-the-floor assumption); gridless material falls back to an
 * energy-driven slow turn + bass-pulse shockwaves. Deck EQ falls back to
 * flat (0.5) when no decks are reported, so the groups stay lit. Canvas 2D,
 * gradients + reflections for the glass columns.
 *
 * Assigned tech: 24-band spectrum + deck EQ (register groups/kills) + full
 * metric ladder (beat/bar/phrase/section).
 */

import { energyHue, energyOf } from '../../style';
import { monstercatSpread } from '../../bands';
import type { DeckStateInfo } from '../../channel';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const SPREAD_FACTOR = 1.7;
const SHOCKWAVE_LIFE_S = 1.3;
const PEAK_HOLD_S = 0.28;
/** Peak shard gravity, height-fractions per second². */
const PEAK_GRAVITY = 3.2;
/** Column ballistic fall (per second) — punchy: fast attack, quick release. */
const COLUMN_FALL = 7.5;
const HUE_DRIFT_DEG_PER_S = 8;
/** Rack morph seconds — arc↔ring↔line eases rather than snaps. */
const RACK_MORPH_S = 0.55;

/** Positive modulo — barIndex can be negative before the first downbeat. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Smoothstep 0→1. */
function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface PeakShard {
  value: number;
  heldFor: number;
  velocity: number;
}

interface Shockwave {
  age: number;
  strength: number;
}

/** A resolved column layout position + facing, in normalized screen space. */
interface Slot {
  /** Base center x, in [0,1] of width. */
  x: number;
  /** Base y (floor line), in [0,1] of height. */
  y: number;
  /** Depth 0 (near/front) … 1 (far/back) — scales width + dims. */
  depth: number;
}

class AnalyzerCathedralRenderer implements PresetRenderer {
  private peaks: PeakShard[] = [];
  /** Smoothed per-column heights for punchy-but-not-jittery ballistics. */
  private heights: number[] = [];
  private prevBar: number | null = null;
  /** Smoothed quarter-turn of the whole colonnade (radians). */
  private turn = 0;
  private turnTarget = 0;
  /** Free-running turn when there is no grid. */
  private drift = 0;
  /** Rack index 0 arc, 1 ring, 2 line; morph blends between racks. */
  private rack = 0;
  private prevRack = 0;
  private rackMorph = 1; // 1 = fully at `rack`
  /** Section hall inversion 0 (floor down) … 1 (flipped). */
  private inversion = 0;
  private inversionTarget = 0;
  /** Palette regime swap 0 (warm story) … 1 (cool). */
  private regime = 0;
  private regimeTarget = 0;
  private shocks: Shockwave[] = [];
  private prevBeatPhase = 1;
  private flash = 0;
  private hueJump = 0;
  /** Smoothed per-group EQ gains (low/mid/high), so kills glide. */
  private groupGain = [1, 1, 1];

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
    const dt = frame.dt;

    // --- Metric tiers -----------------------------------------------------
    const barInPhrase = hasGrid ? mod(barIndex as number, 4) : 0;
    const phrasePhase = hasGrid
      ? (barInPhrase + (beat as { barPhase: number }).barPhase) / 4
      : null;

    if (hasGrid) {
      const bi = barIndex as number;
      if (this.prevBar !== null && bi !== this.prevBar) {
        // Per bar: snap the colonnade to the next quarter turn.
        this.turnTarget = mod(bi, 4) * (Math.PI / 2);
        const phraseRollover = mod(bi, 4) === 0;
        const sectionRollover = mod(bi, 16) === 0;
        if (phraseRollover) {
          // Re-rack: arc → ring → line → arc across successive phrases.
          this.prevRack = this.rack;
          this.rack = (this.rack + 1) % 3;
          this.rackMorph = 0;
          this.hueJump = (this.hueJump + 40) % 360;
          this.flash = Math.max(this.flash, 0.55);
        }
        if (sectionRollover) {
          // The hall inverts + the palette regime swaps.
          this.inversionTarget = this.inversionTarget > 0.5 ? 0 : 1;
          this.regimeTarget = this.regimeTarget > 0.5 ? 0 : 1;
          this.flash = 0.9;
        }
      }
      this.prevBar = bi;
    } else {
      this.prevBar = null;
      // Gridless: colonnade drifts, bass pulse fakes downbeats for shocks.
      this.drift += dt * (0.15 + 1.0 * energy);
      this.turnTarget = this.drift;
    }

    // Smooth the turn toward its per-bar target (shortest path).
    let turnDelta = this.turnTarget - this.turn;
    turnDelta = ((turnDelta % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    this.turn += turnDelta * Math.min(1, dt * 6);

    // Ease rack morph, inversion, regime.
    this.rackMorph = Math.min(1, this.rackMorph + dt / RACK_MORPH_S);
    this.inversion += (this.inversionTarget - this.inversion) * Math.min(1, dt * 2.2);
    this.regime += (this.regimeTarget - this.regime) * Math.min(1, dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 1.6);

    // --- Beat floor-shockwaves -------------------------------------------
    // Fire on the beat wrap (phase crosses from ~1 back to ~0) with a grid;
    // gridless, fire on a strong bass onset.
    const beatPhase = beat?.phase ?? null;
    if (beatPhase !== null) {
      if (beatPhase < this.prevBeatPhase - 0.3) {
        this.shocks.push({ age: 0, strength: 0.6 + 0.4 * frame.impulse.low });
      }
      this.prevBeatPhase = beatPhase;
    } else if (frame.impulse.low > 0.35) {
      // Debounce gridless kicks so we don't spawn a wall of rings.
      if (this.shocks.length === 0 || this.shocks[this.shocks.length - 1].age > 0.18) {
        this.shocks.push({ age: 0, strength: 0.5 + 0.5 * frame.impulse.low });
      }
    }
    for (const s of this.shocks) s.age += dt;
    this.shocks = this.shocks.filter((s) => s.age < SHOCKWAVE_LIFE_S);

    // --- Anticipation glow over the phrase's last bar ---------------------
    const anticipation =
      phrasePhase !== null ? smoothstep((phrasePhase - 0.75) / 0.25) : 0;

    // --- Spectrum → 24 column levels (punchy ballistics) ------------------
    const levels = monstercatSpread(frame.spectrum, SPREAD_FACTOR);
    const count = levels.length;

    const cx = width / 2;
    const unit = Math.min(width, height);

    // Palette: energyHue base, hue jump + centroid tilt, regime swap warps
    // the whole story by ~150° so a section reads as a different hall.
    const baseHue = energyHue(
      energy,
      frame.time * HUE_DRIFT_DEG_PER_S +
        this.hueJump +
        (frame.centroid - 0.5) * 60 +
        this.regime * 150
    );

    // Background: dark energy floor lifted by the tier flash (rate-limited).
    const bgLight = 2 + 4 * energy + 9 * this.flash;
    ctx.fillStyle = `hsl(${baseHue}, 90%, ${Math.min(18, bgLight)}%)`;
    ctx.fillRect(0, 0, width, height);

    if (count === 0) {
      return;
    }

    while (this.peaks.length < count) {
      this.peaks.push({ value: 0, heldFor: 0, velocity: 0 });
    }
    while (this.heights.length < count) this.heights.push(0);

    // --- Deck EQ register groups -----------------------------------------
    // Split the 24 columns into thirds: low / mid / high registers. Each
    // group's gain rides the summed deck EQ knob for that band; a kill
    // (knob → 0) collapses the group. Falls back to flat when no decks.
    const eq = this.aggregateEq(frame.decks);
    // Map EQ knob 0..1 (0.5 flat) → gain: below flat cuts toward 0 (kill),
    // above flat boosts a touch. Smoothed so collapses glide.
    const targetGain = [
      this.eqToGain(eq.low),
      this.eqToGain(eq.mid),
      this.eqToGain(eq.high),
    ];
    for (let g = 0; g < 3; g++) {
      this.groupGain[g] += (targetGain[g] - this.groupGain[g]) * Math.min(1, dt * 4);
    }

    const scale = frame.params.scale ?? 1;
    const intensity = frame.params.intensity ?? 1;

    // Resolve column slots for the current + previous rack, then blend.
    const slotsNow = this.rackSlots(this.rack, count);
    const slotsPrev = this.rackSlots(this.prevRack, count);
    const m = smoothstep(this.rackMorph);

    // Base geometry (in unit space). Floor line sits low; inversion lifts
    // the reflection above by mirroring around the floor's own line.
    const maxColHeight = unit * 0.4 * scale;

    // Draw far-to-near for correct overlap: sort indices by depth desc.
    const order: number[] = [];
    for (let i = 0; i < count; i++) order.push(i);
    order.sort((a, b) => {
      const da = lerp(slotsPrev[b].depth, slotsNow[b].depth, m);
      const db = lerp(slotsPrev[a].depth, slotsNow[a].depth, m);
      return da - db;
    });

    ctx.globalCompositeOperation = 'lighter';

    for (const i of order) {
      const group = i < count / 3 ? 0 : i < (2 * count) / 3 ? 1 : 2;
      const gain = this.groupGain[group];

      // Punchy ballistics: instant rise to the level, quick release.
      const raw = levels[i] * gain;
      if (raw >= this.heights[i]) {
        this.heights[i] = raw; // instant attack
      } else {
        this.heights[i] = Math.max(raw, this.heights[i] - COLUMN_FALL * dt * this.heights[i]);
      }
      const level = this.heights[i];

      // Peak shard: instant rise, hold, gravity free-fall.
      const peak = this.peaks[i];
      if (raw >= peak.value) {
        peak.value = raw;
        peak.heldFor = 0;
        peak.velocity = 0;
      } else {
        peak.heldFor += dt;
        if (peak.heldFor > PEAK_HOLD_S) {
          peak.velocity += PEAK_GRAVITY * dt;
          peak.value = Math.max(raw, peak.value - peak.velocity * dt);
        }
      }

      const s = {
        x: lerp(slotsPrev[i].x, slotsNow[i].x, m),
        y: lerp(slotsPrev[i].y, slotsNow[i].y, m),
        depth: lerp(slotsPrev[i].depth, slotsNow[i].depth, m),
      };

      // Depth foreshortening: far columns are narrower + shorter + dimmer.
      const depthScale = 1 - 0.45 * s.depth;
      const baseX = s.x * width;
      const floorY = s.y * height;
      const colW = Math.max(1.5, unit * 0.02 * scale * depthScale);
      const colH = Math.max(1, level * maxColHeight * depthScale) * intensity;

      // Shockwave lift: rings passing a column light + kick it up a touch.
      let shockLight = 0;
      let shockLift = 0;
      const distFromCenter = Math.abs(baseX - cx) / (unit * 0.5);
      for (const sw of this.shocks) {
        const front = sw.age / SHOCKWAVE_LIFE_S; // 0..1 expanding radius
        const near = 1 - Math.min(1, Math.abs(front - distFromCenter) * 6);
        if (near > 0) {
          const life = 1 - sw.age / SHOCKWAVE_LIFE_S;
          shockLight += near * life * sw.strength;
          shockLift += near * life * sw.strength * unit * 0.03;
        }
      }
      shockLight = Math.min(1, shockLight);

      // Column hue: drifts across the colonnade so shape carries band
      // identity while color travels. Register groups tint slightly apart.
      const hue = (baseHue + (i / count) * 70 + group * 14) % 360;
      const litness = Math.min(
        92,
        34 + 34 * level + 22 * anticipation + 30 * shockLight
      );

      // The glass column body: vertical gradient, brighter at the hot tip.
      const topY = floorY - colH - shockLift;
      const grad = ctx.createLinearGradient(0, floorY, 0, topY);
      grad.addColorStop(0, `hsla(${hue}, 100%, ${litness * 0.55}%, 0.85)`);
      grad.addColorStop(1, `hsla(${hue}, 100%, ${litness}%, 0.95)`);
      ctx.fillStyle = grad;
      ctx.fillRect(baseX - colW / 2, topY, colW, colH + shockLift);

      // Hot tip line — reads as the bar "hitting".
      const tipH = Math.min(colH, Math.max(2, unit * 0.004));
      ctx.fillStyle = `hsla(${hue}, 100%, ${Math.min(96, 76 + 18 * anticipation)}%, ${
        0.5 + 0.5 * level
      })`;
      ctx.fillRect(baseX - colW / 2, topY, colW, tipH);

      // Floor reflection: a fainter, gradient-faded mirror below the floor
      // (or above, when the hall is inverted). Glass sheen.
      const refl = this.inversion; // 0 below, 1 above
      const reflH = colH * 0.6;
      const reflSign = 1 - 2 * refl; // +1 below, -1 above
      const reflTopY = floorY;
      const rgrad = ctx.createLinearGradient(
        0,
        reflTopY,
        0,
        reflTopY + reflSign * reflH
      );
      rgrad.addColorStop(0, `hsla(${hue}, 100%, ${litness * 0.5}%, 0.35)`);
      rgrad.addColorStop(1, `hsla(${hue}, 100%, ${litness * 0.5}%, 0)`);
      ctx.fillStyle = rgrad;
      if (reflSign > 0) {
        ctx.fillRect(baseX - colW / 2, reflTopY, colW, reflH);
      } else {
        ctx.fillRect(baseX - colW / 2, reflTopY - reflH, colW, reflH);
      }

      // Peak shard: a floating light cap above the column.
      if (peak.value > 0.01) {
        const shardY = floorY - peak.value * gain * maxColHeight * depthScale * intensity - shockLift;
        const shardH = Math.max(2, unit * 0.006 * depthScale);
        ctx.fillStyle = `hsla(${(hue + 20) % 360}, 100%, ${Math.min(
          96,
          70 + 20 * anticipation
        )}%, ${0.55 + 0.4 * peak.value})`;
        ctx.fillRect(baseX - colW * 0.7, shardY - shardH, colW * 1.4, shardH);
      }

      // Bloom: a soft radial halo at the hot tip when the column is loud.
      if (level > 0.35) {
        const bloomR = colW * (1.5 + 3 * level);
        const bloom = ctx.createRadialGradient(baseX, topY, 0, baseX, topY, bloomR);
        bloom.addColorStop(0, `hsla(${hue}, 100%, ${litness}%, ${0.28 * level})`);
        bloom.addColorStop(1, `hsla(${hue}, 100%, ${litness}%, 0)`);
        ctx.fillStyle = bloom;
        ctx.fillRect(baseX - bloomR, topY - bloomR, bloomR * 2, bloomR * 2);
      }
    }

    // --- Floor line + shockwave rings ------------------------------------
    // A dim floor line across the base; shockwaves sweep along it as arcs
    // that widen from the center.
    const floorBaseY = height * 0.72;
    ctx.fillStyle = `hsla(${baseHue}, 80%, 40%, 0.18)`;
    ctx.fillRect(0, floorBaseY, width, Math.max(1, unit * 0.002));

    for (const sw of this.shocks) {
      const life = 1 - sw.age / SHOCKWAVE_LIFE_S;
      const r = unit * (0.03 + sw.age * 0.85);
      const flipY = this.inversion > 0.5 ? height - floorBaseY : floorBaseY;
      ctx.beginPath();
      // Elliptical ring hugging the floor for the fake-3D ground plane.
      ctx.save();
      ctx.translate(cx, flipY);
      ctx.scale(1, 0.28);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.restore();
      ctx.strokeStyle = `hsla(${(baseHue + 30) % 360}, 100%, 72%, ${life * 0.5 * sw.strength})`;
      ctx.lineWidth = Math.max(1.5, unit * 0.01 * life);
      ctx.stroke();
    }

    // --- Center keystone: pumps with the kick, the stable mass -----------
    const snap = beat ? Math.pow(1 - beat.phase, 3) : frame.bands.low * frame.bands.low;
    const kr = unit * (0.018 + 0.016 * snap + 0.02 * frame.impulse.low);
    ctx.fillStyle = `hsla(${baseHue}, 100%, ${52 + 32 * snap}%, ${0.35 + 0.45 * snap})`;
    ctx.beginPath();
    ctx.arc(cx, floorBaseY, kr, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Sum the audible decks' EQ knobs for one band, weighted by deck level, so
   * the loudest deck dominates the register groups. Returns flat (0.5) when
   * no deck info is available so the groups stay lit.
   */
  private aggregateEq(decks: DeckStateInfo[]): {
    low: number;
    mid: number;
    high: number;
  } {
    let wSum = 0;
    let low = 0;
    let mid = 0;
    let high = 0;
    for (const d of decks) {
      if (!d.playing) continue;
      const w = 0.15 + d.level; // even a quiet deck contributes a little
      wSum += w;
      low += d.eq.low * w;
      mid += d.eq.mid * w;
      high += d.eq.high * w;
    }
    if (wSum <= 1e-4) return { low: 0.5, mid: 0.5, high: 0.5 };
    return { low: low / wSum, mid: mid / wSum, high: high / wSum };
  }

  /** EQ knob 0..1 (0.5 flat) → group gain. Below ~0.12 reads as a kill. */
  private eqToGain(knob: number): number {
    if (knob < 0.12) return 0; // full kill collapses the group
    // 0.12→0, 0.5→1, 1→1.25, with a soft knee near the bottom.
    const t = (knob - 0.12) / (0.5 - 0.12);
    return knob <= 0.5 ? smoothstep(t) : 1 + (knob - 0.5) * 0.5;
  }

  /**
   * Resolve the 24 column slots for a rack:
   *   0 arc  — shallow arc across the lower third, near-center columns front;
   *   1 ring — full circle around the center, depth by angle;
   *   2 line — a straight flat row (the classic analyzer).
   * Positions are normalized [0,1]; depth 0 near … 1 far.
   */
  private rackSlots(rack: number, count: number): Slot[] {
    const slots: Slot[] = [];
    const floorY = 0.72;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5; // 0..1 across the row
      if (rack === 2) {
        // Straight line.
        slots.push({ x: 0.08 + t * 0.84, y: floorY, depth: 0 });
      } else if (rack === 0) {
        // Shallow arc: x spread wide, y bows down toward the edges, and the
        // edges sit further back (depth) for the fake-3D bow.
        const c = t - 0.5; // -0.5..0.5
        const x = 0.5 + c * 0.86 + Math.sin((this.turn) * 0) * 0; // turn baked below
        const bow = c * c; // 0 center … 0.25 edges
        slots.push({ x, y: floorY - bow * 0.14, depth: bow * 2.4 });
      } else {
        // Full ring: angle around center, quarter-turn applied. Foreshorten
        // vertically for the ground-plane ring; back half sits further.
        const a = (i / count) * Math.PI * 2 + this.turn;
        const rx = 0.34;
        const ry = 0.12;
        const x = 0.5 + Math.cos(a) * rx;
        const y = floorY - 0.06 + Math.sin(a) * ry;
        const depth = (Math.sin(a) + 1) / 2; // back (top) far, front near
        slots.push({ x, y, depth });
      }
    }
    // For the arc rack, fold the per-bar quarter-turn into a horizontal
    // shear so the arc visibly tumbles without leaving the frame.
    if (rack === 0) {
      const shear = Math.sin(this.turn) * 0.12;
      for (const s of slots) {
        s.x = Math.min(0.97, Math.max(0.03, s.x + (s.x - 0.5) * shear));
      }
    }
    return slots;
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'hall scale', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'intensity', label: 'column intensity', min: 0.4, max: 2, step: 0.05, default: 1 },
];

const g03AnalyzerCathedralPreset: VisualizerPreset = {
  id: 'g03-analyzer-cathedral',
  name: 'g03 analyzer-cathedral',
  hiRes: true,
  params,
  create: () => new AnalyzerCathedralRenderer(),
};

export default g03AnalyzerCathedralPreset;
