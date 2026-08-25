import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;

function ease(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function seedOf(frame: VisualizerFrameData): number {
  const channel = (frame as VisualizerFrameData & { dominantChannel?: string | null })
    .dominantChannel;
  const chosen = frame.decks.find((deck) => deck.channel === channel);
  if (chosen?.trackId != null) return chosen.trackId;
  let id = 1403;
  let level = -1;
  for (const deck of frame.decks) {
    if (deck.level > level && deck.trackId != null) {
      id = deck.trackId;
      level = deck.level;
    }
  }
  return id;
}

function gear(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  teeth: number,
  angle: number,
  hue: number,
  level: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = `hsl(${hue}, 100%, ${30 + level * 22}%)`;
  ctx.strokeStyle = `hsl(${(hue + 48) % 360}, 100%, 70%)`;
  ctx.lineWidth = Math.max(3, radius * 0.035);
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU;
    const r = radius * (i % 2 === 0 ? 1.13 : 1);
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = `hsl(${(hue + 175) % 360}, 100%, 12%)`;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.53, 0, TAU);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    ctx.rotate(TAU / 4);
    ctx.fillStyle = `hsl(${hue}, 100%, 55%)`;
    ctx.fillRect(radius * 0.5, -radius * 0.045, radius * 0.47, radius * 0.09);
  }
  ctx.restore();
}

class MonumentOrreryRenderer implements PresetRenderer {
  private seed = 0;
  private step = 0;
  private fromStep = 0;
  private moveAge = 99;
  private lastBeat = -1;
  private escapement = 0;
  private lastSnare = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const seed = seedOf(frame);
    if (seed !== this.seed) {
      this.seed = seed;
      this.step = 0;
      this.fromStep = 0;
    }
    const beat = frame.beat;
    const ordinal = beat
      ? (beat.ladderBarIndex ?? beat.barIndex) * beat.beatsPerBar + beat.beatInBar
      : Math.floor(frame.time / 2);
    if (ordinal !== this.lastBeat && this.lastBeat >= 0 && frame.bands.low > 0.1) {
      this.fromStep = this.step;
      this.step += 1;
      this.moveAge = 0;
    }
    this.lastBeat = ordinal;
    if (frame.impulse.mid > 0.22 && this.lastSnare <= 0.22) this.escapement += 1;
    this.lastSnare = frame.impulse.mid;
    this.moveAge += dt;
    const movement = ease(this.moveAge / 0.72);
    const position = this.fromStep + (this.step - this.fromStep) * movement;
    const hue = ((seed * 29) % 360 + 360) % 360;
    const slow = frame.bandsSlow ?? frame.bands;

    ctx.fillStyle = `hsl(${(hue + 190) % 360}, 58%, 4%)`;
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height);
    const cx = width * 0.48;
    const cy = height * 0.52;
    const r1 = unit * 0.29;
    const r2 = unit * 0.19;
    const r3 = unit * 0.11;
    const teeth1 = 12 + Math.abs(seed % 5);
    const teeth2 = 9 + Math.abs((seed >>> 3) % 4);
    const a1 = position * TAU / teeth1;
    const a2 = -position * TAU / teeth2 + 0.18;
    const a3 = this.escapement * TAU / 8;
    const x2 = cx + r1 * 0.95;
    const y2 = cy - r1 * 0.3;
    const x3 = x2 + r2 * 0.82;
    const y3 = y2 + r2 * 0.82;

    ctx.strokeStyle = `hsl(${(hue + 80) % 360}, 100%, 66%)`;
    ctx.lineWidth = unit * 0.035;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.stroke();
    gear(ctx, cx, cy, r1, teeth1, a1, hue, slow.low);
    gear(ctx, x2, y2, r2, teeth2, a2, (hue + 105) % 360, slow.mid);
    gear(ctx, x3, y3, r3, 8, a3, (hue + 205) % 360, slow.high);

    const pinX = cx + Math.cos(a1) * r1 * 0.67;
    const pinY = cy + Math.sin(a1) * r1 * 0.67;
    const pin2X = x2 + Math.cos(a2 + Math.PI) * r2 * 0.62;
    const pin2Y = y2 + Math.sin(a2 + Math.PI) * r2 * 0.62;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = unit * 0.018;
    ctx.beginPath();
    ctx.moveTo(pinX, pinY);
    ctx.lineTo(pin2X, pin2Y);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of [[pinX, pinY], [pin2X, pin2Y]]) {
      ctx.beginPath();
      ctx.arc(x, y, unit * 0.024, 0, TAU);
      ctx.fill();
    }
  }
}

const preset: VisualizerPreset = {
  id: 'g14-monument-orrery',
  name: 'g14 monument orrery',
  create: () => new MonumentOrreryRenderer(),
};

export default preset;
