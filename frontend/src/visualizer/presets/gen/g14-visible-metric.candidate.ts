import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

function trackSeed(frame: VisualizerFrameData): number {
  const channel = (frame as VisualizerFrameData & { dominantChannel?: string | null })
    .dominantChannel;
  const chosen = frame.decks.find((deck) => deck.channel === channel);
  if (chosen?.trackId != null) return chosen.trackId;
  return frame.decks.reduce((best, deck) => (deck.level > best.level ? deck : best), frame.decks[0])
    ?.trackId ?? 1402;
}

class VisibleMetricRenderer implements PresetRenderer {
  private lastPhrase = -1;
  private skyline: Array<{ hue: number; width: number }> = [];
  private flash = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : Math.floor(frame.time / 2);
    const bar = mod(tierBar, 4);
    const phrase = Math.floor(tierBar / 4);
    const section = Math.floor(tierBar / 16);
    const phase = beat?.barPhase ?? mod(frame.time / 2, 1);
    const seed = trackSeed(frame);
    const hue = mod(seed * 17 + phrase * 67 + section * 41, 360);
    if (this.lastPhrase >= 0 && phrase !== this.lastPhrase) {
      this.skyline.push({ hue: mod(seed * 17 + this.lastPhrase * 67, 360), width: 0.7 + frame.spread * 0.5 });
      if (this.skyline.length > 5) this.skyline.shift();
      this.flash = 1;
    }
    this.lastPhrase = phrase;
    this.flash = Math.max(0, this.flash - dt * 1.8);

    ctx.fillStyle = `hsl(${mod(hue + 190, 360)}, 60%, ${5 + this.flash * 6}%)`;
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height);
    const cx = width / 2;
    const ground = height * 0.83;

    for (let i = 0; i < this.skyline.length; i++) {
      const entry = this.skyline[i];
      const x = width * (0.12 + i * 0.19);
      const w = unit * 0.1 * entry.width;
      const h = unit * (0.1 + i * 0.015);
      ctx.fillStyle = `hsla(${entry.hue}, 100%, 42%, 0.38)`;
      ctx.fillRect(x - w / 2, ground - h, w, h);
    }

    const bridgeW = unit * (0.58 + (frame.spectrum[2] ?? 0) * 0.08);
    const bridgeH = unit * 0.46;
    const left = cx - bridgeW / 2;
    const bayY = [ground - unit * 0.08, ground - bridgeH, ground - bridgeH, ground - bridgeH - unit * 0.13];
    const colors = [hue, hue + 58, hue + 126, hue + 194];

    ctx.setLineDash([8, 9]);
    ctx.lineWidth = Math.max(2, unit * 0.004);
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `hsla(${mod(colors[i], 360)}, 100%, 65%, 0.34)`;
      ctx.strokeRect(left + i * bridgeW / 4 + 5, bayY[i], bridgeW / 4 - 10, unit * 0.08);
    }
    ctx.setLineDash([]);

    for (let i = 0; i < 4; i++) {
      if (i > bar) continue;
      const active = i === bar;
      const settle = active ? phase * phase * (3 - 2 * phase) : 1;
      const targetX = left + i * bridgeW / 4 + 5;
      const targetY = bayY[i];
      const y = targetY - (1 - settle) * height * 0.56;
      const kick = active ? frame.impulse.low * unit * 0.025 : 0;
      ctx.fillStyle = `hsl(${mod(colors[i], 360)}, 100%, ${active ? 58 : 43}%)`;
      ctx.fillRect(targetX, y + kick, bridgeW / 4 - 10, unit * 0.08);
      ctx.fillStyle = `hsla(${mod(colors[i] + 40, 360)}, 100%, 82%, 0.8)`;
      ctx.fillRect(targetX, y + kick, bridgeW / 4 - 10, unit * 0.012);
    }

    ctx.strokeStyle = `hsl(${mod(hue + 95, 360)}, 100%, 58%)`;
    ctx.lineWidth = unit * 0.025;
    ctx.beginPath();
    ctx.moveTo(left + bridgeW * 0.12, ground);
    ctx.lineTo(left + bridgeW * 0.22, ground - bridgeH + unit * 0.08);
    ctx.moveTo(left + bridgeW * 0.88, ground);
    ctx.lineTo(left + bridgeW * 0.78, ground - bridgeH + unit * 0.08);
    ctx.stroke();

    const craneX = left + (bar + 0.5) * bridgeW / 4;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.5 + frame.impulse.mid * 0.5;
    ctx.lineWidth = Math.max(2, unit * 0.004);
    ctx.beginPath();
    ctx.moveTo(cx - bridgeW * 0.6, height * 0.12);
    ctx.lineTo(cx + bridgeW * 0.6, height * 0.12);
    ctx.moveTo(craneX, height * 0.12);
    ctx.lineTo(craneX, bayY[bar] - (1 - phase) * height * 0.56);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const preset: VisualizerPreset = {
  id: 'g14-visible-metric',
  name: 'g14 visible metric',
  create: () => new VisibleMetricRenderer(),
};

export default preset;
