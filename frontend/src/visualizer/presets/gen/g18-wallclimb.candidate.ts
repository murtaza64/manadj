/**
 * g18-wallclimb — a climber ascends a 16-ledge wall, one ledge per bar,
 * one quantized hold-move per beat. Height = bar-in-section at a glance;
 * passed ledges stay lit (the trail is the bar count). Summit at the
 * section boundary, then the wall re-skins and the climber rappels down.
 * Kicks = grip shockwaves + wall shudder; snares = crack flashes across
 * passed ledges; hats = bolt glints. Backdrop: spectrum-lit rock strata.
 */

import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

function mod(v: number, b: number): number {
  return ((v % b) + b) % b;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
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
  return best ?? 1618;
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

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
}

interface Crack {
  ledge: number;
  seed: number;
  life: number;
}

class WallclimbRenderer implements PresetRenderer {
  private lastSection = Number.NEGATIVE_INFINITY;
  private lastBeatKey = Number.NEGATIVE_INFINITY;
  private moveShown = 0; // eased quantized progress within the bar (0..1)
  private settle = 0; // per-beat snap settle
  private rings: Ring[] = [];
  private cracks: Crack[] = [];
  private lastRingAt = -9;
  private lastCrackAt = -9;
  private shake = 0;
  private shakePhase = 0;
  private flare = 0; // summit flare (1 → 0), once per 16 bars
  private rappel = 0; // post-summit descent (1 → 0)
  private sectionHue = 210;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = clamp(frame.dt, 0, 0.1);
    const meter = meterOf(frame);
    const barInSection = mod(meter.tierBar, 16);
    const section = Math.floor(meter.tierBar / 16);
    const seed = trackSeed(frame);
    const minDim = Math.min(width, height);

    if (section !== this.lastSection) {
      const first = this.lastSection === Number.NEGATIVE_INFINITY;
      this.lastSection = section;
      this.sectionHue = mod(seed * 41 + section * 73, 360);
      if (!first) {
        this.flare = 1;
        this.rappel = 1;
      }
      this.cracks = [];
    }
    this.flare = Math.max(0, this.flare - dt / 0.4);
    this.rappel = Math.max(0, this.rappel - dt / 0.45);
    this.settle = Math.max(0, this.settle - dt / 0.1);
    this.shake = Math.max(0, this.shake - dt / 0.15);
    this.shakePhase += dt * 55;

    // Quantized move: after beat b the climber is (b+1)/4 of the way up the
    // current bar segment. Snap on the beat, 0.1s settle, then LOCK.
    const beatKey = meter.tierBar * 16 + meter.beatInBar;
    if (beatKey !== this.lastBeatKey) {
      this.lastBeatKey = beatKey;
      this.settle = 1;
    }
    const target = (meter.beatInBar + 1) / meter.beatsPerBar;
    const prev = meter.beatInBar / meter.beatsPerBar;
    const ease = 1 - this.settle * this.settle;
    this.moveShown = prev + (target - prev) * ease;

    const hue = this.sectionHue;

    // --- backdrop: dark rock strata, edges lit by the spectrum ---
    ctx.fillStyle = `hsl(${hue}, 25%, 4%)`;
    ctx.fillRect(0, 0, width, height);
    const strataContrast = frame.params.strata ?? 0.5;
    const strataCount = 12;
    for (let i = 0; i < strataCount; i++) {
      const y0 = (height * i) / strataCount;
      const bandH = height / strataCount;
      const j = Math.min(23, i * 2);
      const level = clamp(((frame.spectrum[j] ?? 0) + (frame.spectrum[j + 1] ?? 0)) / 2, 0, 1);
      ctx.fillStyle = `hsl(${mod(hue + i * 4, 360)}, 28%, ${(4 + (i % 2) * 1.6).toFixed(1)}%)`;
      ctx.fillRect(0, y0, width, bandH);
      ctx.fillStyle = `hsla(${mod(hue + 30 + i * 6, 360)}, 85%, 58%, ${(level * 0.35 * strataContrast).toFixed(3)})`;
      ctx.fillRect(0, y0, width, Math.max(1.5, bandH * 0.06));
    }

    // --- wall geometry ---
    const wallW = width * 0.36;
    const wallX = width / 2 - wallW / 2;
    const topY = height * 0.09;
    const baseY = height * 0.93;
    const step = (baseY - topY) / 16;
    const ledgeY = (i: number) => baseY - i * step;

    // Kick shudder: bounded decaying oscillation, deterministic.
    const shudderAmp = (frame.params.shudder ?? 0.6) * 5;
    const shakeX = Math.sin(this.shakePhase) * this.shake * this.shake * shudderAmp;
    ctx.save();
    ctx.translate(shakeX, 0);

    // Wall slab.
    ctx.fillStyle = `hsl(${hue}, 30%, 8%)`;
    ctx.fillRect(wallX, topY - step * 0.6, wallW, baseY - topY + step * 1.2);
    ctx.strokeStyle = `hsla(${hue}, 40%, 30%, 0.5)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(wallX, topY - step * 0.6, wallW, baseY - topY + step * 1.2);

    // --- ledges: passed lit, current bright, future faint ---
    for (let i = 0; i < 16; i++) {
      const y = ledgeY(i);
      const passed = i < barInSection;
      const current = i === barInSection;
      const phraseEdge = i % 4 === 0;
      const alpha = current ? 0.95 : passed ? 0.4 : 0.12;
      const light = current ? 62 : passed ? 52 : 40;
      ctx.strokeStyle = `hsla(${mod(hue + (phraseEdge ? 40 : 0), 360)}, 90%, ${light}%, ${alpha})`;
      ctx.lineWidth = phraseEdge ? 3.5 : 2;
      ctx.beginPath();
      ctx.moveTo(wallX + wallW * 0.06, y);
      ctx.lineTo(wallX + wallW * 0.94, y);
      ctx.stroke();
      if (phraseEdge) {
        // Phrase marker chip on the left rail.
        ctx.fillStyle = `hsla(${mod(hue + 40, 360)}, 90%, ${light}%, ${alpha})`;
        ctx.fillRect(wallX - minDim * 0.018, y - 3, minDim * 0.012, 6);
      }
    }

    // --- holds for the current bar (4 per bar segment); lit = beats done ---
    const holdX = (bar: number, b: number) =>
      wallX + wallW * (0.5 + (hash(seed + bar * 7.3 + b * 13.7) - 0.5) * 0.56);
    const holdY = (bar: number, b: number) => ledgeY(bar) - ((b + 1) / 4) * step;
    for (let b = 0; b < meter.beatsPerBar; b++) {
      const hx = holdX(barInSection, b);
      const hy = holdY(barInSection, b);
      const done = b < meter.beatInBar || (b === meter.beatInBar && this.settle < 0.5);
      ctx.fillStyle = done
        ? `hsla(${mod(hue + 40, 360)}, 95%, 60%, 0.95)`
        : `hsla(${hue}, 40%, 35%, 0.55)`;
      ctx.beginPath();
      ctx.arc(hx, hy, minDim * (done ? 0.007 : 0.005), 0, Math.PI * 2);
      ctx.fill();
      // Hat glints on lit bolts.
      if (done && frame.impulse.high > 0.3) {
        const g = clamp(frame.impulse.high, 0, 1) * 0.8;
        const r = minDim * 0.014;
        ctx.strokeStyle = `hsla(${mod(hue + 60, 360)}, 90%, 78%, ${g.toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(hx - r, hy);
        ctx.lineTo(hx + r, hy);
        ctx.moveTo(hx, hy - r);
        ctx.lineTo(hx, hy + r);
        ctx.stroke();
      }
    }

    // --- climber position ---
    let cy: number;
    let cx: number;
    if (this.rappel > 0) {
      // Post-summit rappel: slide from summit to base, rope visible.
      const p = 1 - this.rappel;
      cy = ledgeY(16) + (ledgeY(0) - ledgeY(16)) * p * p;
      cx = wallX + wallW / 2;
      ctx.strokeStyle = `hsla(${mod(hue + 40, 360)}, 60%, 70%, 0.6)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, ledgeY(16) - step * 0.4);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    } else {
      cy = ledgeY(barInSection) - this.moveShown * step;
      const bNow = clamp(meter.beatInBar, 0, 3);
      cx = holdX(barInSection, bNow);
    }

    // Buildup = coiled squash; dropTransition = overshoot leap w/ ghosts.
    const buildup = clamp(frame.regime?.buildup ?? 0, 0, 1);
    const dropT = clamp(frame.regime?.dropTransition ?? 0, 0, 1);
    const squash = 1 - buildup * 0.16;
    const leap = dropT * step * 0.35;
    const bodyR = minDim * 0.016;

    const drawClimber = (x: number, y: number, alpha: number) => {
      ctx.save();
      ctx.translate(x, y - leap);
      ctx.scale(1, squash);
      ctx.globalAlpha = alpha;
      // Limbs toward nearby holds.
      ctx.strokeStyle = `hsl(${mod(hue + 180, 360)}, 85%, 62%)`;
      ctx.lineWidth = Math.max(2, bodyR * 0.32);
      const reach = bodyR * 2.6;
      const armPhase = meter.beatInBar % 2 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(0, -bodyR * 0.4);
      ctx.lineTo(armPhase * reach * 0.8, -reach);
      ctx.moveTo(0, -bodyR * 0.4);
      ctx.lineTo(-armPhase * reach * 0.6, -reach * 0.55);
      ctx.moveTo(0, bodyR * 0.9);
      ctx.lineTo(reach * 0.55, reach * 0.8);
      ctx.moveTo(0, bodyR * 0.9);
      ctx.lineTo(-reach * 0.55, reach * 0.9);
      ctx.stroke();
      // Torso + head.
      ctx.fillStyle = `hsl(${mod(hue + 180, 360)}, 90%, 60%)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, bodyR * 0.72, bodyR, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsl(${mod(hue + 200, 360)}, 80%, 72%)`;
      ctx.beginPath();
      ctx.arc(0, -bodyR * 1.5, bodyR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    if (dropT > 0.1) {
      drawClimber(cx, cy + step * 0.3, 0.18 * dropT);
      drawClimber(cx, cy + step * 0.15, 0.3 * dropT);
    }
    drawClimber(cx, cy, 1);

    // --- kick shockwave rings from the grip ---
    if (frame.impulse.low > 0.5 && frame.time - this.lastRingAt > 0.12) {
      this.lastRingAt = frame.time;
      this.shake = clamp(frame.impulse.low, 0, 1);
      if (this.rings.length < 6) {
        this.rings.push({ x: cx, y: cy, r: bodyR, life: 1 });
      }
    }
    for (const ring of this.rings) {
      ring.r += dt * minDim * 0.55;
      ring.life -= dt / 0.45;
      if (ring.life > 0) {
        ctx.strokeStyle = `hsla(${mod(hue + 40, 360)}, 95%, 60%, ${(ring.life * 0.55).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.5, 4 * ring.life);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    this.rings = this.rings.filter((r) => r.life > 0);

    // --- snare cracks across passed ledges ---
    if (
      frame.impulse.mid > 0.55 &&
      frame.time - this.lastCrackAt > 0.14 &&
      barInSection > 0 &&
      this.cracks.length < 3
    ) {
      this.lastCrackAt = frame.time;
      const ledge = Math.floor(hash(meter.tierBar * 3.1 + frame.time) * barInSection);
      this.cracks.push({ ledge, seed: frame.time, life: 1 });
    }
    for (const crack of this.cracks) {
      crack.life -= dt / 0.18;
      if (crack.life <= 0) continue;
      const y = ledgeY(crack.ledge);
      ctx.strokeStyle = `hsla(${mod(hue + 90, 360)}, 95%, 70%, ${(crack.life * 0.85).toFixed(3)})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      let px = wallX + wallW * 0.08;
      ctx.moveTo(px, y);
      const segs = 7;
      for (let k = 1; k <= segs; k++) {
        px = wallX + wallW * (0.08 + (0.84 * k) / segs);
        const py = y + (hash(crack.seed * 17 + k) - 0.5) * step * 0.9;
        ctx.lineTo(px, k === segs ? y : py);
      }
      ctx.stroke();
    }
    this.cracks = this.cracks.filter((c) => c.life > 0);

    // --- summit flare (once per 16 bars, localized at the top) ---
    if (this.flare > 0) {
      const fl = this.flare * (frame.params.flare ?? 0.6);
      const fx = wallX + wallW / 2;
      const fy = topY - step * 0.5;
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, minDim * 0.4);
      grad.addColorStop(0, `hsla(${mod(hue + 40, 360)}, 90%, 75%, ${(fl * 0.7).toFixed(3)})`);
      grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
    // Summit flag.
    ctx.strokeStyle = `hsla(${mod(hue + 40, 360)}, 80%, 60%, 0.8)`;
    ctx.lineWidth = 2;
    const flagX = wallX + wallW / 2;
    ctx.beginPath();
    ctx.moveTo(flagX, topY - step * 0.55);
    ctx.lineTo(flagX, topY - step * 1.3);
    ctx.stroke();
    ctx.fillStyle = `hsl(${mod(hue + 40, 360)}, 90%, 58%)`;
    ctx.beginPath();
    ctx.moveTo(flagX, topY - step * 1.3);
    ctx.lineTo(flagX + minDim * 0.03, topY - step * 1.12);
    ctx.lineTo(flagX, topY - step * 0.94);
    ctx.closePath();
    ctx.fill();

    ctx.restore(); // shake
  }
}

const preset: VisualizerPreset = {
  id: 'g18-wallclimb',
  name: 'g18 wallclimb',
  params: [
    { id: 'shudder', label: 'kick shudder', min: 0, max: 1, step: 0.05, default: 0.6 },
    { id: 'strata', label: 'strata glow', min: 0, max: 1, step: 0.05, default: 0.5 },
    { id: 'flare', label: 'summit flare', min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  create: () => new WallclimbRenderer(),
};

export default preset;
