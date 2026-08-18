/**
 * "g02 mirror-ladder" (genetic arena g02): a CROSSOVER of two winners —
 * Mirror's center-out mirrored spectrum bars carrying Ladder's metric
 * theatre. The 24-band spectrum still unfolds low-at-center / highs-outward
 * to both sides, but the whole field is now driven by the grid's metric
 * ladder:
 *
 *   per bar   → the bar AXIS quarter-rotates (0°→90°→180°→270°) so the
 *               mirrored field tumbles around its center once per 4 bars;
 *   4-bar     → the MIRROR AXIS COUNT steps 1→2→3 across the phrase, so a
 *   phrase       the spectrum reflects across one, then two, then three
 *               axes — the field fractures into more symmetry as the
 *               phrase fills;
 *   16-bar    → the whole field INVERTS (bars grow toward the center
 *   section      instead of away) and a white SHOCKWAVE sweeps outward;
 *   phrase    → an ANTICIPATION GLOW builds over the phrase's last bar —
 *   tail         the "something is coming" surge from Ladder.
 *
 * Tiers derive from beat.barIndex anchored at the first downbeat (the
 * four-on-the-floor assumption); gridless material falls back to
 * energy-driven axis drift + a bass-pulse. Canvas 2D, no GL.
 *
 * Assigned tech: full metric ladder + 24-band spectrum.
 */

import { energyHue, energyOf } from '../../style';
import { monstercatSpread } from '../../bands';
import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const HUE_DRIFT_DEG_PER_S = 6;
const SPREAD_FACTOR = 1.7;
const SHOCKWAVE_LIFE_S = 1.4;

/** Positive modulo — barIndex can be negative before the first downbeat. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Smoothstep 0→1. */
function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

class MirrorLadderRenderer implements PresetRenderer {
  private prevBar: number | null = null;
  /** Smoothed per-bar quarter-rotation target (radians). */
  private axisAngle = 0;
  /** Free-running drift when there is no grid. */
  private drift = 0;
  /** Section inversion sign (1 = grow outward, -1 = grow inward). */
  private inversion = 1;
  /** White shockwave age; < 0 means dead. */
  private shockAge = -1;
  private flash = 0;
  private hueJump = 0;

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

    // --- Metric tiers from the absolute bar index -------------------------
    const barInPhrase = hasGrid ? mod(barIndex as number, 4) : 0;
    const phrasePhase = hasGrid
      ? (barInPhrase + (beat as { barPhase: number }).barPhase) / 4
      : null;

    // Rollover events, escalating by tier.
    if (hasGrid) {
      if (this.prevBar !== null && barIndex !== this.prevBar) {
        const phraseRollover = mod(barIndex as number, 4) === 0;
        const sectionRollover = mod(barIndex as number, 16) === 0;
        // Per bar: snap the axis to the next quarter turn.
        this.axisAngle = mod(barIndex as number, 4) * (Math.PI / 2);
        if (phraseRollover) {
          this.hueJump = (this.hueJump + 60) % 360;
          this.flash = 0.6;
        }
        if (sectionRollover) {
          this.inversion *= -1; // the section tell: the field turns inside-out
          this.shockAge = 0;
          this.flash = 1;
        }
      }
      this.prevBar = barIndex;
    } else {
      this.prevBar = null;
      // Gridless: axis drifts with energy, bass pulse fakes the downbeat.
      this.drift += frame.dt * (0.2 + 1.4 * energy);
      this.axisAngle = this.drift;
    }
    this.flash = Math.max(0, this.flash - frame.dt * 1.6);
    if (this.shockAge >= 0) {
      this.shockAge += frame.dt;
      if (this.shockAge > SHOCKWAVE_LIFE_S) this.shockAge = -1;
    }

    // --- Mirror axis count: 1 → 2 → 3 across the phrase --------------------
    // barInPhrase 0,1 → 1 axis; 2 → 2; 3 → 3. Gridless holds one axis.
    const mirrorAxes = hasGrid ? [1, 1, 2, 3][barInPhrase] : 1;

    // --- Anticipation glow over the phrase's last bar ---------------------
    const anticipation =
      phrasePhase !== null ? smoothstep((phrasePhase - 0.75) / 0.25) : 0;

    // --- Spectrum → mirrored bar levels -----------------------------------
    const levels = monstercatSpread(frame.spectrum, SPREAD_FACTOR);
    const count = levels.length;

    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const hue = energyHue(
      energy,
      frame.time * HUE_DRIFT_DEG_PER_S + this.hueJump + (frame.centroid - 0.5) * 60
    );

    // Background: dark energy floor lifted by the phrase/section flash.
    ctx.fillStyle = `hsl(${hue}, 100%, ${2 + 5 * energy + 12 * this.flash}%)`;
    ctx.fillRect(0, 0, width, height);

    if (count === 0) {
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    const scale = frame.params.scale ?? 1;
    const barSpan = unit * 0.46 * scale;
    const columns = count * 2;
    const gap = barSpan / columns / 3;
    const barWidth = Math.max(1, (barSpan - gap * (columns - 1)) / columns);
    const maxHalfHeight = unit * 0.42 * scale;
    // Section inversion drags the growth origin from the axis toward the
    // rim, so inverted bars read as growing INWARD.
    const inward = this.inversion < 0;
    const intensity = frame.params.intensity ?? 1;

    ctx.globalCompositeOperation = 'lighter';

    // Draw the mirrored spectrum once per reflection axis. Each axis is the
    // bar-quarter-rotation plus an even fan across the mirror-count.
    for (let a = 0; a < mirrorAxes; a++) {
      const axisAngle = this.axisAngle + (a / mirrorAxes) * Math.PI;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(axisAngle);
      // Along the rotated axis, bars run horizontally; the perpendicular is
      // the mirror line, so the spectrum unfolds both left and right.
      const alpha = 0.55 + 0.45 / mirrorAxes;

      for (let cIndex = 0; cIndex < columns; cIndex++) {
        const half = columns / 2;
        const band = cIndex < half ? half - 1 - cIndex : cIndex - half;
        const level = levels[band];
        if (level <= 0.004) continue;
        const x = -barSpan / 2 + cIndex * (barWidth + gap);
        const halfHeight = Math.max(1, level * maxHalfHeight) * intensity;
        const lightness = 40 + 30 * level + 25 * anticipation;
        ctx.fillStyle = `hsla(${(hue + a * 12) % 360}, 100%, ${Math.min(
          92,
          lightness
        )}%, ${alpha})`;
        if (inward) {
          // Grow from the outer rim toward the center axis.
          const outer = maxHalfHeight;
          ctx.fillRect(x, outer - halfHeight, barWidth, halfHeight);
          ctx.fillRect(x, -outer, barWidth, halfHeight);
        } else {
          // Classic Mirror: grow symmetrically out from the axis.
          ctx.fillRect(x, -halfHeight, barWidth, halfHeight * 2);
        }
        // Hot tips.
        const tip = Math.min(halfHeight, Math.max(2, unit * 0.004));
        ctx.fillStyle = `hsla(${(hue + a * 12) % 360}, 100%, ${Math.min(
          95,
          78 + 15 * anticipation
        )}%, ${(0.5 + 0.5 * level) * alpha})`;
        if (inward) {
          const outer = maxHalfHeight;
          ctx.fillRect(x, outer - halfHeight, barWidth, tip);
          ctx.fillRect(x, -outer + halfHeight - tip, barWidth, tip);
        } else {
          ctx.fillRect(x, -halfHeight, barWidth, tip);
          ctx.fillRect(x, halfHeight - tip, barWidth, tip);
        }
      }

      // The mirror axis line itself, brightening with anticipation.
      ctx.fillStyle = `hsla(${hue}, 100%, ${65 + 25 * anticipation}%, ${
        (0.25 + 0.4 * anticipation) * alpha
      })`;
      ctx.fillRect(-barSpan / 2, -0.5, barSpan, 1 + 2 * anticipation);
      ctx.restore();
    }

    // --- Center mass: a small square pumping with the kick ----------------
    const snap = beat ? Math.pow(1 - beat.phase, 3) : frame.bands.low * frame.bands.low;
    const radius = unit * (0.03 + 0.02 * snap + 0.03 * frame.impulse.low);
    ctx.fillStyle = `hsla(${hue}, 100%, ${55 + 35 * snap}%, ${0.4 + 0.5 * snap})`;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    // --- Section shockwave: a white ring sweeping outward -----------------
    if (this.shockAge >= 0) {
      const life = 1 - this.shockAge / SHOCKWAVE_LIFE_S;
      const r = unit * (0.05 + this.shockAge * 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${life * 0.85})`;
      ctx.lineWidth = Math.max(2, unit * 0.02 * life);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'field scale', min: 0.5, max: 1.6, step: 0.05, default: 1 },
  { id: 'intensity', label: 'bar intensity', min: 0.4, max: 2, step: 0.05, default: 1 },
];

const g02MirrorLadderPreset: VisualizerPreset = {
  id: 'g02-mirror-ladder',
  name: 'g02 mirror-ladder',
  params,
  create: () => new MirrorLadderRenderer(),
};

export default g02MirrorLadderPreset;
