/**
 * g18-countdown — bars REMAINING to the section boundary as launch
 * countdown. A giant two-digit 7-segment numeral (16 → 1) hard-flips on
 * every bar; four beat pips fill ON beats; a rail sweeps barPhase. The
 * final four bars arm the panel (pure color swap + conduits); at zero the
 * palette fires and rotates. Flat design: matte fills, hard edges,
 * committed scheme, motion by transforms and color swaps.
 */

import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

function mod(v: number, b: number): number {
  return ((v % b) + b) % b;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function trackSeed(frame: VisualizerFrameData): number {
  const chosen = frame.decks.find((d) => d.channel === frame.dominantChannel);
  if (chosen?.trackId != null) return chosen.trackId;
  let best: number | null = null;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (deck.trackId != null && deck.level > bestLevel) {
      best = deck.trackId;
      bestLevel = deck.level;
    }
  }
  return best ?? 907;
}

/** Segment truth table: [A top, B tr, C br, D bottom, E bl, F tl, G mid]. */
const SEG: number[][] = [
  [1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 0, 0, 0, 0],
  [1, 1, 0, 1, 1, 0, 1],
  [1, 1, 1, 1, 0, 0, 1],
  [0, 1, 1, 0, 0, 1, 1],
  [1, 0, 1, 1, 0, 1, 1],
  [1, 0, 1, 1, 1, 1, 1],
  [1, 1, 1, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 0, 1, 1],
];

/** Draw one 7-seg digit; segments as beveled bars. */
function drawDigit(
  ctx: CanvasRenderingContext2D,
  digit: number,
  x: number,
  y: number,
  w: number,
  h: number,
  on: string,
  off: string | null
): void {
  const t = w * 0.18; // segment thickness
  const seg = SEG[clamp(Math.floor(digit), 0, 9)];
  const bar = (
    cx: number,
    cy: number,
    len: number,
    horizontal: boolean,
    lit: boolean
  ) => {
    if (!lit && !off) return;
    ctx.fillStyle = lit ? on : (off as string);
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(cx - len / 2 + t / 2, cy - t / 2);
      ctx.lineTo(cx + len / 2 - t / 2, cy - t / 2);
      ctx.lineTo(cx + len / 2, cy);
      ctx.lineTo(cx + len / 2 - t / 2, cy + t / 2);
      ctx.lineTo(cx - len / 2 + t / 2, cy + t / 2);
      ctx.lineTo(cx - len / 2, cy);
    } else {
      ctx.moveTo(cx - t / 2, cy - len / 2 + t / 2);
      ctx.lineTo(cx, cy - len / 2);
      ctx.lineTo(cx + t / 2, cy - len / 2 + t / 2);
      ctx.lineTo(cx + t / 2, cy + len / 2 - t / 2);
      ctx.lineTo(cx, cy + len / 2);
      ctx.lineTo(cx - t / 2, cy + len / 2 - t / 2);
    }
    ctx.closePath();
    ctx.fill();
  };
  const g = t * 0.18; // bevel gap
  const hw = w - t;
  const hh = (h - t * 1.5) / 2;
  bar(x + w / 2, y + t / 2, hw - g, true, seg[0] === 1);
  bar(x + w - t / 2, y + t / 2 + hh / 2 + t / 4, hh - g, false, seg[1] === 1);
  bar(x + w - t / 2, y + h - t / 2 - hh / 2 - t / 4, hh - g, false, seg[2] === 1);
  bar(x + w / 2, y + h - t / 2, hw - g, true, seg[3] === 1);
  bar(x + t / 2, y + h - t / 2 - hh / 2 - t / 4, hh - g, false, seg[4] === 1);
  bar(x + t / 2, y + t / 2 + hh / 2 + t / 4, hh - g, false, seg[5] === 1);
  bar(x + w / 2, y + h / 2, hw - g, true, seg[6] === 1);
}

interface Meter {
  tierBar: number;
  barPhase: number;
  beatInBar: number;
  beatsPerBar: number;
}

function meterOf(frame: VisualizerFrameData): Meter {
  const beat = frame.beat;
  if (beat) {
    return {
      tierBar: beat.ladderBarIndex ?? beat.barIndex,
      barPhase: clamp(beat.barPhase, 0, 0.999),
      beatInBar: beat.beatInBar,
      beatsPerBar: Math.max(1, beat.beatsPerBar),
    };
  }
  const t = frame.time / 2;
  const phase = mod(t, 1);
  return { tierBar: Math.floor(t), barPhase: phase, beatInBar: Math.floor(phase * 4), beatsPerBar: 4 };
}

class CountdownRenderer implements PresetRenderer {
  private lastTierBar = Number.NEGATIVE_INFINITY;
  private lastSection = Number.NEGATIVE_INFINITY;
  private settle = 0; // numeral flip settle (1 → 0)
  private fire = 0; // section-zero fire flash (1 → 0), once per 16 bars
  private jolt = 0; // kick displacement envelope
  private joltAngle = 0;
  private lastJoltAt = -9;
  private glint = 0; // snare sweep (1 → 0)
  private stripePos = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = clamp(frame.dt, 0, 0.1);
    const meter = meterOf(frame);
    const barInSection = mod(meter.tierBar, 16);
    const count = 16 - barInSection; // 16 .. 1
    const section = Math.floor(meter.tierBar / 16);
    const seed = trackSeed(frame);
    const slow = frame.bandsSlow ?? frame.bands;

    if (meter.tierBar !== this.lastTierBar) {
      if (this.lastTierBar !== Number.NEGATIVE_INFINITY) this.settle = 1;
      this.lastTierBar = meter.tierBar;
    }
    if (section !== this.lastSection) {
      if (this.lastSection !== Number.NEGATIVE_INFINITY) this.fire = 1;
      this.lastSection = section;
    }
    this.settle = Math.max(0, this.settle - dt / 0.12);
    this.fire = Math.max(0, this.fire - dt / 0.18);
    this.jolt = Math.max(0, this.jolt - dt / 0.1);
    this.glint = Math.max(0, this.glint - dt / 0.13);

    const joltStrength = frame.params.joltStrength ?? 0.6;
    if (frame.impulse.low > 0.5 && frame.time - this.lastJoltAt > 0.12) {
      this.lastJoltAt = frame.time;
      this.jolt = clamp(frame.impulse.low, 0, 1);
      this.joltAngle = mod(meter.tierBar * 2.399 + meter.beatInBar * 1.7, Math.PI * 2);
    }
    if (frame.impulse.mid > 0.55 && this.glint < 0.25) this.glint = 1;

    // --- palette (flat, committed; armed = hue swap, luminance parity) ---
    const armed = count <= 4;
    const baseHue = mod(seed * 53 + section * 97, 360);
    const armedSpan = frame.params.armedSpan ?? 160;
    const hue = armed ? mod(baseHue + armedSpan, 360) : baseHue;
    const bg = `hsl(${baseHue}, 42%, 6%)`;
    const stripe = `hsl(${baseHue}, 46%, 9%)`;
    const lit = `hsl(${hue}, 95%, 58%)`;
    const dim = `hsl(${hue}, 45%, 13%)`;
    const accent = `hsl(${mod(hue + 40, 360)}, 90%, 60%)`;

    // --- background: flat drifting diagonal stripes (bandsSlow motion) ---
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const stripeEnergy = frame.params.stripeEnergy ?? 0.5;
    this.stripePos += dt * (12 + slow.mid * 90 * stripeEnergy);
    const sw = Math.max(36, width * 0.045);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-0.42);
    const span = Math.hypot(width, height);
    const offset = mod(this.stripePos, sw * 2);
    ctx.fillStyle = stripe;
    for (let x = -span / 2 - sw * 2 + offset; x < span / 2; x += sw * 2) {
      ctx.fillRect(x, -span / 2, sw, span);
    }
    ctx.restore();

    // --- panel transform (kick jolt = displacement, not brightness) ---
    const jx = Math.cos(this.joltAngle) * this.jolt * 7 * joltStrength;
    const jy = Math.sin(this.joltAngle) * this.jolt * 5 * joltStrength;
    ctx.save();
    ctx.translate(jx, jy);

    // --- numeral geometry ---
    const scaleBase = Math.min(width, height);
    const digitH = scaleBase * 0.44;
    const digitW = digitH * 0.56;
    const gap = digitW * 0.16;
    const twoDigits = count >= 10;
    const totalW = twoDigits ? digitW * 2 + gap : digitW;
    const nx = width / 2 - totalW / 2;
    const ny = height / 2 - digitH * 0.58;

    // Bar-flip settle: the new numeral drops in and squashes (integer jump).
    const s = this.settle;
    const squash = 1 - 0.16 * s * s;
    const drop = -digitH * 0.1 * s * s;
    ctx.save();
    ctx.translate(width / 2, ny + digitH / 2 + drop);
    ctx.scale(1, squash);
    ctx.translate(-width / 2, -(ny + digitH / 2));
    if (twoDigits) {
      drawDigit(ctx, Math.floor(count / 10), nx, ny, digitW, digitH, lit, dim);
      drawDigit(ctx, count % 10, nx + digitW + gap, ny, digitW, digitH, lit, dim);
    } else {
      drawDigit(ctx, count, nx, ny, digitW, digitH, lit, dim);
    }
    // Snare glint: one bright band sweeping the numeral, clipped flat.
    if (this.glint > 0) {
      const p = 1 - this.glint;
      ctx.save();
      ctx.beginPath();
      ctx.rect(nx - gap, ny, totalW + gap * 2, digitH);
      ctx.clip();
      const gx = nx - gap + (totalW + gap * 2) * p;
      ctx.fillStyle = `hsla(${mod(hue + 20, 360)}, 70%, 85%, ${(0.3 * this.glint).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(gx, ny);
      ctx.lineTo(gx + digitW * 0.3, ny);
      ctx.lineTo(gx + digitW * 0.05, ny + digitH);
      ctx.lineTo(gx - digitW * 0.25, ny + digitH);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // --- beat pips (fill hard ON beats) ---
    const pipY = ny + digitH + scaleBase * 0.07;
    const pipR = scaleBase * 0.016;
    const pipGap = pipR * 4.4;
    const beatFract = clamp(meter.barPhase * meter.beatsPerBar - meter.beatInBar, 0, 1);
    for (let b = 0; b < meter.beatsPerBar; b++) {
      const px = width / 2 + (b - (meter.beatsPerBar - 1) / 2) * pipGap;
      const isNow = b === meter.beatInBar;
      const pop = isNow ? Math.pow(1 - beatFract, 2) : 0;
      ctx.fillStyle = b <= meter.beatInBar ? lit : dim;
      ctx.beginPath();
      ctx.arc(px, pipY, pipR * (1 + pop * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- barPhase rail with hat-flickered ticks ---
    const railY = pipY + scaleBase * 0.05;
    const railW = totalW * 1.35;
    const railX = width / 2 - railW / 2;
    const railH = Math.max(3, scaleBase * 0.007);
    ctx.fillStyle = dim;
    ctx.fillRect(railX, railY, railW, railH);
    ctx.fillStyle = accent;
    ctx.fillRect(railX, railY, railW * meter.barPhase, railH);
    for (let q = 0; q <= 4; q++) {
      const tx = railX + (railW * q) / 4;
      const flick = clamp(0.45 + frame.impulse.high * 0.55, 0, 1);
      ctx.fillStyle = `hsla(${mod(hue + 40, 360)}, 85%, 70%, ${flick.toFixed(3)})`;
      ctx.fillRect(tx - 1, railY - railH * 1.6, 2, railH * 4.2);
    }

    // --- armed conduits: one per elapsed bar of the final four ---
    const conduitW = scaleBase * 0.012;
    const conduitH = digitH * 0.22;
    const charge = clamp(frame.regime?.buildup ?? 0, 0, 1);
    for (let cSlot = 0; cSlot < 4; cSlot++) {
      const litSlot = armed && cSlot < 5 - count;
      const side = cSlot % 2 === 0 ? -1 : 1;
      const tier = Math.floor(cSlot / 2);
      const cx = width / 2 + side * (totalW / 2 + gap * 2.6);
      const cy = ny + digitH * 0.26 + tier * (conduitH + scaleBase * 0.02);
      ctx.fillStyle = litSlot ? accent : dim;
      ctx.fillRect(cx - conduitW / 2, cy, conduitW, conduitH);
      if (armed && !litSlot && charge > 0.05) {
        // Buildup regime breathes the unlit conduits toward armed (color only).
        ctx.fillStyle = `hsla(${mod(hue + 40, 360)}, 80%, 40%, ${(charge * 0.4).toFixed(3)})`;
        ctx.fillRect(cx - conduitW / 2, cy + conduitH * (1 - charge), conduitW, conduitH * charge);
      }
    }

    ctx.restore(); // jolt

    // --- section fire: single rate-limited flash + afterimage (per 16 bars) ---
    if (this.fire > 0) {
      const a = 0.34 * this.fire * this.fire;
      ctx.fillStyle = `hsla(${mod(baseHue + armedSpan, 360)}, 80%, 70%, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
  }
}

const preset: VisualizerPreset = {
  id: 'g18-countdown',
  name: 'g18 countdown',
  params: [
    { id: 'stripeEnergy', label: 'stripe drift', min: 0, max: 1, step: 0.05, default: 0.5 },
    { id: 'joltStrength', label: 'kick jolt', min: 0, max: 1, step: 0.05, default: 0.6 },
    { id: 'armedSpan', label: 'armed hue shift', min: 60, max: 220, step: 10, default: 160 },
  ],
  create: () => new CountdownRenderer(),
};

export default preset;
