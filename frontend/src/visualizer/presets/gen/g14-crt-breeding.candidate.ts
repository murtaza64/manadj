/** g14-crt-breeding: four broadcast programs breed a center hybrid. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

function trackSeed(frame: VisualizerFrameData): number {
  const channel = (frame as VisualizerFrameData & { dominantChannel?: string | null }).dominantChannel;
  const deck = channel
    ? frame.decks.find((d) => d.channel === channel)
    : frame.decks.reduce<VisualizerFrameData['decks'][number] | null>((a, d) => d.playing && (!a || d.level > a.level) ? d : a, null);
  return deck?.trackId ?? 1;
}

class CrtBreedingRenderer implements PresetRenderer {
  private pair: [number, number] = [0, 1];
  private lastPhrase: number | null = null;
  private tear = 0;
  private tearY = 0.5;
  private beam = 0;
  private phase = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.phase += dt * (0.3 + slow.mid * 0.8) * (frame.params.motion ?? 1);
    this.beam = Math.max(frame.impulse.low, this.beam - dt / 0.32);
    if (frame.impulse.mid > 0.28 && this.tear < 0.1) {
      this.tear = frame.impulse.mid;
      this.tearY = mod(frame.time * 0.173, 0.7) + 0.15;
    }
    this.tear = Math.max(0, this.tear - dt / 0.28);

    const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
    const phrase = tierBar === null ? 0 : Math.floor(tierBar / 8);
    if (phrase !== this.lastPhrase) {
      const seed = Math.abs(trackSeed(frame) + phrase * 17);
      this.pair = [mod(seed, 4), mod(Math.floor(seed / 7) + 1, 4)];
      if (this.pair[0] === this.pair[1]) this.pair[1] = mod(this.pair[1] + 1, 4);
      this.lastPhrase = phrase;
    }

    const px = Math.max(2, Math.round((frame.params.pixel ?? 1) * Math.min(width, height) / 240));
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(width / px));
    off.height = Math.max(1, Math.floor(height / px));
    const c = off.getContext('2d');
    if (!c) return;
    const w = off.width;
    const h = off.height;
    const hue = mod(frame.centroid * 300 + trackSeed(frame) * 13, 360);
    c.fillStyle = 'hsl(225, 55%, 3%)';
    c.fillRect(0, 0, w, h);

    const boxes: Array<[number, number, number, number]> = [
      [w * 0.06, h * 0.08, w * 0.38, h * 0.32],
      [w * 0.56, h * 0.08, w * 0.38, h * 0.32],
      [w * 0.06, h * 0.6, w * 0.38, h * 0.32],
      [w * 0.56, h * 0.6, w * 0.38, h * 0.32],
    ];
    boxes.forEach((box, i) => this.drawProgram(c, box, i, frame, hue));

    const child: [number, number, number, number] = [w * 0.32, h * 0.35, w * 0.36, h * 0.3];
    c.fillStyle = 'hsl(225, 60%, 4%)';
    c.fillRect(...child);
    c.save();
    c.beginPath();
    c.rect(...child);
    c.clip();
    this.drawProgram(c, child, this.pair[0], frame, hue + 40);
    c.globalAlpha = 0.58 + frame.flatness * 0.2;
    this.drawProgram(c, child, this.pair[1], frame, hue - 60);
    c.restore();
    c.strokeStyle = `hsl(${hue}, 100%, 68%)`;
    c.lineWidth = 2;
    c.strokeRect(...child);

    c.strokeStyle = `hsla(${mod(hue + 120, 360)}, 100%, 66%, 0.75)`;
    c.lineWidth = 1;
    for (const parent of this.pair) {
      const b = boxes[parent];
      c.beginPath();
      c.moveTo(b[0] + b[2] / 2, b[1] + b[3] / 2);
      c.lineTo(child[0] + child[2] / 2, child[1] + child[3] / 2);
      c.stroke();
    }

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, width, height);
    const bulge = 1 + this.beam * 0.015;
    const dw = width * 0.94 * bulge;
    const dh = height * 0.9 * bulge;
    const dx = (width - dw) / 2;
    const dy = (height - dh) / 2;
    ctx.drawImage(off, dx, dy, dw, dh);

    const scanDepth = frame.params.scanlines ?? 1;
    ctx.fillStyle = `rgba(0,0,0,${0.24 * scanDepth})`;
    for (let y = dy; y < dy + dh; y += Math.max(3, px * 2)) ctx.fillRect(dx, y, dw, Math.max(1, px * 0.45));
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.12;
    for (let x = dx; x < dx + dw; x += 3) {
      ctx.fillStyle = x % 9 < 3 ? '#f00' : x % 9 < 6 ? '#0f0' : '#04f';
      ctx.fillRect(x, dy, 1, dh);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (this.tear > 0) {
      const y = dy + dh * this.tearY;
      ctx.fillStyle = `hsla(${hue}, 100%, 75%, ${this.tear})`;
      ctx.fillRect(dx + width * 0.03 * Math.sin(frame.time * 40), y, dw * 0.9, Math.max(2, height * 0.006));
    }
    ctx.strokeStyle = '#101827';
    ctx.lineWidth = Math.max(8, Math.min(width, height) * 0.045);
    ctx.strokeRect(dx, dy, dw, dh);
  }

  private drawProgram(
    c: CanvasRenderingContext2D,
    [x, y, w, h]: [number, number, number, number],
    program: number,
    frame: VisualizerFrameData,
    hue: number
  ): void {
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    c.fillStyle = `hsl(${mod(hue + program * 67 + 180, 360)}, 70%, 6%)`;
    c.fillRect(x, y, w, h);
    if (program === 0) {
      const count = Math.min(24, frame.spectrum.length);
      for (let i = 0; i < count; i++) {
        const bh = clamp(frame.spectrum[i] ?? 0) * h * 0.85;
        c.fillStyle = `hsl(${mod(hue + i * 11, 360)}, 100%, 55%)`;
        c.fillRect(x + i * w / count, y + h - bh, Math.max(1, w / count - 1), bh);
      }
    } else if (program === 1) {
      const wave = frame.wave?.left;
      c.beginPath();
      const n = wave ? Math.min(128, wave.length) : 64;
      for (let i = 0; i < n; i++) {
        const value = wave ? wave[Math.floor(i / n * wave.length)] : Math.sin(i * 0.5 + this.phase) * frame.bands.mid;
        const xx = x + i / (n - 1) * w;
        const yy = y + h / 2 + value * h * 0.35;
        if (i === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
      }
      c.strokeStyle = `hsl(${mod(hue + 80, 360)}, 100%, 68%)`;
      c.lineWidth = 2;
      c.stroke();
    } else if (program === 2) {
      const count = 5 + Math.floor(frame.spread * 8);
      const beatPhase = frame.beat?.phase ?? 0;
      for (let i = 0; i < count; i++) {
        c.beginPath();
        c.arc(x + w / 2, y + h / 2, (i + beatPhase) * Math.min(w, h) / count, 0, TAU);
        c.strokeStyle = `hsla(${mod(hue + i * 28, 360)}, 100%, 60%, 0.75)`;
        c.stroke();
      }
    } else {
      const cols = 4;
      const rows = 3;
      for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) {
        const pulse = (xx + yy) % 3 === 0 ? frame.impulse.high : frame.bands.high;
        c.fillStyle = `hsl(${mod(hue + (xx + yy * cols) * 31, 360)}, 100%, ${38 + pulse * 30}%)`;
        c.fillRect(x + xx * w / cols, y + yy * h / rows, w / cols - 1, h / rows - 1);
      }
    }
    c.restore();
  }
}

const params: PresetParam[] = [
  { id: 'pixel', label: 'phosphor pixel scale', min: 0.5, max: 2, step: 0.1, default: 1 },
  { id: 'scanlines', label: 'scanline depth', min: 0.3, max: 1.8, step: 0.05, default: 1 },
  { id: 'motion', label: 'program motion', min: 0.3, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = {
  id: 'g14-crt-breeding',
  name: 'g14 crt-breeding',
  wantsWave: true,
  params,
  create: () => new CrtBreedingRenderer(),
};

export default preset;
