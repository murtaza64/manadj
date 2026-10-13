/**
 * g18-manuscript — the meter as a score that writes itself.
 *
 * One page = one 16-bar section: 4 systems (rows) of 4 bar cells. A pen
 * sweeps the current cell with barPhase; transients stamp permanent ink
 * (kick = low notehead, snare = mid diamond, hat = high tick). Barlines,
 * row advance per phrase, page turn per section. The page IS the memory
 * of the section — bar position is where the pen is, at a glance.
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
  return best ?? 1811;
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
  return {
    tierBar: Math.floor(t),
    barPhase: phase,
    beatInBar: Math.floor(phase * 4),
    beatsPerBar: 4,
  };
}

interface Stamp {
  bar: number; // 0..15 within the page
  x: number; // 0..1 within the bar cell
  y: number; // 0..1 within the row (vertical)
  kind: 0 | 1 | 2; // kick / snare / hat
  mag: number;
}

interface Layout {
  left: number;
  top: number;
  rowW: number;
  rowH: number;
  rowGap: number;
}

const STAMP_CAP_PER_BAR = 26;

class ManuscriptRenderer implements PresetRenderer {
  private page: HTMLCanvasElement | null = null;
  private pageCtx: CanvasRenderingContext2D | null = null;
  private pageW = 0;
  private pageH = 0;
  private stamps: Stamp[] = [];
  private barCounts = new Array<number>(16).fill(0);
  private lastSection = Number.NEGATIVE_INFINITY;
  private turn = 0; // page-turn wipe envelope (1 → 0)
  private lastStampAt: [number, number, number] = [-9, -9, -9];
  private sectionHue = 0;

  private layout(width: number, height: number): Layout {
    const marginX = width * 0.07;
    const marginY = height * 0.09;
    const rowW = width - marginX * 2;
    const usable = height - marginY * 2;
    const rowGap = usable * 0.06;
    const rowH = (usable - rowGap * 3) / 4;
    return { left: marginX, top: marginY, rowW, rowH, rowGap };
  }

  private inkColors(): [string, string, string] {
    const h = this.sectionHue;
    return [
      `hsl(${mod(h, 360)}, 95%, 62%)`,
      `hsl(${mod(h + 130, 360)}, 92%, 60%)`,
      `hsl(${mod(h + 215, 360)}, 90%, 64%)`,
    ];
  }

  private rebuildPage(width: number, height: number): void {
    if (!this.page) {
      this.page = document.createElement('canvas');
      this.pageCtx = this.page.getContext('2d');
    }
    if (this.pageW !== width || this.pageH !== height) {
      this.page.width = Math.max(1, width);
      this.page.height = Math.max(1, height);
      this.pageW = width;
      this.pageH = height;
    }
    const pctx = this.pageCtx;
    if (!pctx) return;
    pctx.clearRect(0, 0, width, height);
    const L = this.layout(width, height);
    // Staff lines + barlines for the 4 systems.
    for (let row = 0; row < 4; row++) {
      const y0 = L.top + row * (L.rowH + L.rowGap);
      pctx.strokeStyle = 'rgba(150, 165, 200, 0.22)';
      pctx.lineWidth = 1;
      for (let line = 0; line < 5; line++) {
        const y = y0 + (L.rowH * (0.15 + (0.7 * line) / 4));
        pctx.beginPath();
        pctx.moveTo(L.left, y);
        pctx.lineTo(L.left + L.rowW, y);
        pctx.stroke();
      }
      pctx.strokeStyle = 'rgba(170, 185, 220, 0.4)';
      pctx.lineWidth = 2;
      for (let b = 0; b <= 4; b++) {
        const x = L.left + (L.rowW * b) / 4;
        pctx.beginPath();
        pctx.moveTo(x, y0 + L.rowH * 0.12);
        pctx.lineTo(x, y0 + L.rowH * 0.88);
        pctx.stroke();
      }
    }
    // Replay stamps.
    for (const s of this.stamps) this.drawStamp(s, L);
  }

  private drawStamp(s: Stamp, L: Layout): void {
    const pctx = this.pageCtx;
    if (!pctx) return;
    const row = Math.floor(s.bar / 4);
    const cell = s.bar % 4;
    const cellW = L.rowW / 4;
    const x = L.left + cell * cellW + s.x * cellW;
    const y0 = L.top + row * (L.rowH + L.rowGap);
    const y = y0 + L.rowH * (0.15 + s.y * 0.7);
    const scale = Math.min(this.pageW, this.pageH) / 1080;
    const inks = this.inkColors();
    pctx.globalAlpha = 0.55 + s.mag * 0.4;
    if (s.kind === 0) {
      // Kick: solid notehead + stem.
      const r = (7 + s.mag * 7) * scale;
      pctx.fillStyle = inks[0];
      pctx.beginPath();
      pctx.ellipse(x, y, r, r * 0.78, -0.3, 0, Math.PI * 2);
      pctx.fill();
      pctx.strokeStyle = inks[0];
      pctx.lineWidth = 2 * scale;
      pctx.beginPath();
      pctx.moveTo(x + r * 0.9, y - r * 0.2);
      pctx.lineTo(x + r * 0.9, y - r * 3.1);
      pctx.stroke();
    } else if (s.kind === 1) {
      // Snare: diamond.
      const r = (6 + s.mag * 6) * scale;
      pctx.fillStyle = inks[1];
      pctx.beginPath();
      pctx.moveTo(x, y - r);
      pctx.lineTo(x + r, y);
      pctx.lineTo(x, y + r);
      pctx.lineTo(x - r, y);
      pctx.closePath();
      pctx.fill();
    } else {
      // Hat: small tick cross.
      const r = (3.5 + s.mag * 4) * scale;
      pctx.strokeStyle = inks[2];
      pctx.lineWidth = 1.6 * scale;
      pctx.beginPath();
      pctx.moveTo(x - r, y - r);
      pctx.lineTo(x + r, y + r);
      pctx.moveTo(x + r, y - r);
      pctx.lineTo(x - r, y + r);
      pctx.stroke();
    }
    pctx.globalAlpha = 1;
  }

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
    const needResize = this.pageW !== width || this.pageH !== height;

    if (section !== this.lastSection) {
      const first = this.lastSection === Number.NEGATIVE_INFINITY;
      this.lastSection = section;
      this.sectionHue = mod(seed * 47 + section * 61, 360);
      this.stamps = [];
      this.barCounts.fill(0);
      if (!first) this.turn = 1;
      this.rebuildPage(width, height);
    } else if (needResize || !this.page) {
      this.rebuildPage(width, height);
    }
    this.turn = Math.max(0, this.turn - dt / 0.55);

    const L = this.layout(width, height);
    const row = Math.floor(barInSection / 4);
    const cell = barInSection % 4;
    const cellW = L.rowW / 4;
    const rowY = L.top + row * (L.rowH + L.rowGap);

    // --- paper ---
    ctx.fillStyle = `hsl(${this.sectionHue}, 32%, 5%)`;
    ctx.fillRect(0, 0, width, height);

    // Current system underlay (which phrase we're in, at a glance).
    ctx.fillStyle = `hsla(${this.sectionHue}, 60%, 50%, 0.055)`;
    ctx.fillRect(L.left - cellW * 0.06, rowY, L.rowW + cellW * 0.12, L.rowH);

    // Beat columns in the current cell — hard quantized lighting ON beats.
    const beatFract = clamp(meter.barPhase * meter.beatsPerBar - meter.beatInBar, 0, 1);
    const hit = clamp(frame.impulse.low + frame.impulse.mid * 0.7, 0, 1);
    for (let b = 0; b < meter.beatsPerBar; b++) {
      const bx = L.left + cell * cellW + (cellW * b) / meter.beatsPerBar;
      const bw = cellW / meter.beatsPerBar;
      if (b < meter.beatInBar) {
        ctx.fillStyle = `hsla(${this.sectionHue}, 70%, 55%, 0.075)`;
        ctx.fillRect(bx, rowY + L.rowH * 0.12, bw, L.rowH * 0.76);
      } else if (b === meter.beatInBar) {
        const pop = Math.pow(1 - beatFract, 2.4);
        const a = 0.09 + pop * (0.18 + hit * 0.1);
        ctx.fillStyle = `hsla(${this.sectionHue}, 85%, 60%, ${a.toFixed(3)})`;
        ctx.fillRect(bx, rowY + L.rowH * 0.12, bw, L.rowH * 0.76);
      }
    }

    // Current bar cell frame.
    ctx.strokeStyle = `hsla(${this.sectionHue}, 90%, 65%, 0.5)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(L.left + cell * cellW, rowY + L.rowH * 0.1, cellW, L.rowH * 0.8);

    // --- stamping (permanent ink) ---
    const threshold = frame.params.inkThreshold ?? 0.48;
    const impulses: Array<[number, 0 | 1 | 2, number]> = [
      [frame.impulse.low, 0, 0.8],
      [frame.impulse.mid, 1, 0.5],
      [frame.impulse.high, 2, 0.2],
    ];
    for (const [level, kind, baseY] of impulses) {
      const thr = kind === 2 ? threshold * 0.9 : threshold;
      if (
        level > thr &&
        frame.time - this.lastStampAt[kind] > 0.09 &&
        this.barCounts[barInSection] < STAMP_CAP_PER_BAR
      ) {
        this.lastStampAt[kind] = frame.time;
        this.barCounts[barInSection]++;
        const stamp: Stamp = {
          bar: barInSection,
          x: clamp(meter.barPhase, 0.02, 0.98),
          y: clamp(baseY + (0.5 - frame.centroid) * 0.22, 0.02, 0.98),
          kind,
          mag: clamp(level, 0, 1),
        };
        this.stamps.push(stamp);
        this.drawStamp(stamp, L);
      }
    }

    // --- blit the page ---
    if (this.page) ctx.drawImage(this.page, 0, 0);

    // --- pen ---
    const penX = L.left + cell * cellW + meter.barPhase * cellW;
    const energy = clamp(
      (frame.bands.low + frame.bands.mid + frame.bands.high) / 2.2,
      0,
      1
    );
    const glow = frame.params.penGlow ?? 0.6;
    ctx.strokeStyle = `hsla(${mod(this.sectionHue + 40, 360)}, 60%, 82%, 0.85)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(penX, rowY + L.rowH * 0.06);
    ctx.lineTo(penX, rowY + L.rowH * 0.94);
    ctx.stroke();
    // Nib: concentric soft dots (cheap glow).
    const nibY = rowY + L.rowH * (0.15 + (0.5 - (frame.centroid - 0.5) * 0.6) * 0.7);
    const nibR = (3 + energy * 6) * (Math.min(width, height) / 1080);
    for (let i = 3; i >= 1; i--) {
      ctx.fillStyle = `hsla(${mod(this.sectionHue + 40, 360)}, 80%, 75%, ${(0.12 * glow * i) / 3 + (i === 1 ? 0.5 : 0)})`;
      ctx.beginPath();
      ctx.arc(penX, nibY, nibR * i, 0, Math.PI * 2);
      ctx.fill();
    }

    // Row markers: which phrases are already written.
    for (let r = 0; r < 4; r++) {
      const my = L.top + r * (L.rowH + L.rowGap) + L.rowH * 0.5;
      const done = r < row;
      const active = r === row;
      ctx.fillStyle = done
        ? `hsla(${this.sectionHue}, 80%, 60%, 0.7)`
        : active
          ? `hsla(${this.sectionHue}, 90%, 70%, 0.9)`
          : 'rgba(140, 150, 180, 0.25)';
      ctx.beginPath();
      ctx.arc(L.left - Math.min(width, height) * 0.025, my, active ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- page turn wipe (once per 16 bars; bounded luminance) ---
    if (this.turn > 0) {
      const drama = frame.params.turnDrama ?? 0.6;
      const p = 1 - this.turn; // 0 → 1 sweep
      const edge = width * (1.15 * p - 0.075);
      const grad = ctx.createLinearGradient(edge - width * 0.12, 0, edge + width * 0.04, 0);
      grad.addColorStop(0, 'hsla(0, 0%, 100%, 0)');
      grad.addColorStop(0.8, `hsla(${this.sectionHue}, 40%, 88%, ${(0.32 * drama).toFixed(3)})`);
      grad.addColorStop(1, 'hsla(0, 0%, 100%, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  }
}

const preset: VisualizerPreset = {
  id: 'g18-manuscript',
  name: 'g18 manuscript',
  params: [
    { id: 'inkThreshold', label: 'ink threshold', min: 0.3, max: 0.7, step: 0.02, default: 0.48 },
    { id: 'penGlow', label: 'pen glow', min: 0, max: 1, step: 0.05, default: 0.6 },
    { id: 'turnDrama', label: 'page-turn drama', min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  create: () => new ManuscriptRenderer(),
};

export default preset;
