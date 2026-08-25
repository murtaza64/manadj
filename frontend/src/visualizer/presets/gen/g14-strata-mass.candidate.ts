import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

function dominantSeed(frame: VisualizerFrameData): number {
  const channel = (frame as VisualizerFrameData & { dominantChannel?: string | null })
    .dominantChannel;
  const selected = frame.decks.find((deck) => deck.channel === channel);
  if (selected?.trackId != null) return selected.trackId;
  let bestId = 1404;
  let bestLevel = -1;
  for (const deck of frame.decks) {
    if (deck.level > bestLevel) {
      bestLevel = deck.level;
      bestId = deck.trackId ?? bestId;
    }
  }
  return bestId;
}

function profile(frame: VisualizerFrameData, width: number, points: number, offset: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < points; i++) {
    const band = Math.floor((i / Math.max(1, points - 1)) * 23);
    const level = frame.spectrum[(band + offset) % 24] ?? 0;
    result.push((i / (points - 1)) * width + level * width * 0.008);
  }
  return result;
}

function drawMass(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  xs: number[],
  baseline: number,
  amplitude: number,
  phase: number,
  color: string,
  seam: string
): void {
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i < xs.length; i++) {
    const t = i / Math.max(1, xs.length - 1);
    const broad = 0.52 + 0.34 * Math.sin(t * Math.PI * 2 + phase) + 0.14 * Math.sin(t * Math.PI * 5 - phase);
    ctx.lineTo(xs[i], baseline - broad * amplitude);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = seam;
  ctx.lineWidth = Math.max(3, height * 0.009);
  ctx.stroke();
}

class StrataMassRenderer implements PresetRenderer {
  private phase = 0;
  private drop = 0;
  private buildup = 0;

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.phase += dt * (0.025 + slow.mid * 0.04) * (frame.params.drift ?? 1);
    const lowPresence = Math.max(0, Math.min(1, (frame.bands.low - 0.2) / 0.5));
    const alpha = 1 - Math.exp(-dt / 0.35);
    this.drop += (frame.trend.excitement * lowPresence - this.drop) * alpha;
    this.buildup += (frame.trend.excitement * (1 - lowPresence) - this.buildup) * alpha;
    const seed = dominantSeed(frame);
    const baseHue = ((seed * 31) % 360 + 360) % 360;
    const tierBar = frame.beat ? (frame.beat.ladderBarIndex ?? frame.beat.barIndex) : 0;
    const section = Math.floor(tierBar / 16);
    const relief = frame.params.relief ?? 1;
    const kick = frame.impulse.low;
    const snare = frame.impulse.mid * (0.4 + frame.bands.high * 0.6);

    const skyHue = (baseHue + 165 + section * 53) % 360;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `hsl(${skyHue}, 100%, ${8 + this.buildup * 8}%)`);
    gradient.addColorStop(1, `hsl(${(skyHue + 55) % 360}, 85%, ${18 + this.drop * 9}%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const sunX = width * (0.15 + (Math.abs(section) % 4) * 0.23);
    const sunY = height * 0.2;
    ctx.fillStyle = `hsl(${(baseHue + 55) % 360}, 100%, 62%)`;
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.min(width, height) * (0.055 + this.drop * 0.018), 0, Math.PI * 2);
    ctx.fill();

    const lowX = profile(frame, width, 7, 0);
    const midX = profile(frame, width, 13, 5);
    const highX = profile(frame, width, 25, 11);
    const horizonLift = height * this.drop * 0.1;
    drawMass(
      ctx,
      width,
      height,
      highX,
      height * 0.7 - horizonLift,
      height * (0.13 + frame.bands.high * 0.11) * relief,
      this.phase * 0.6,
      `hsl(${(baseHue + 205) % 360}, 100%, 27%)`,
      `hsla(${(baseHue + 255) % 360}, 100%, 70%, ${0.35 + snare * 0.65})`
    );
    drawMass(
      ctx,
      width,
      height,
      midX,
      height * 0.82 - horizonLift * 0.65,
      height * (0.2 + frame.bands.mid * 0.16) * relief,
      this.phase,
      `hsl(${(baseHue + 92) % 360}, 100%, 31%)`,
      `hsla(${(baseHue + 130) % 360}, 100%, 75%, ${0.28 + snare * 0.72})`
    );
    drawMass(
      ctx,
      width,
      height,
      lowX,
      height * 0.98,
      height * (0.29 + frame.bands.low * 0.2 + kick * 0.08) * relief,
      this.phase * 0.35,
      `hsl(${baseHue}, 100%, ${31 + kick * 12}%)`,
      `hsl(${(baseHue + 43) % 360}, 100%, 70%)`
    );

    ctx.fillStyle = `hsla(${(baseHue + 45) % 360}, 100%, 82%, ${snare * 0.55})`;
    for (let i = 0; i < 7; i++) {
      const x = width * (i + 0.5) / 7;
      ctx.fillRect(x, height * (0.5 + (i % 3) * 0.11), Math.max(2, width * 0.004), height * 0.2);
    }
  }
}

const params: PresetParam[] = [
  { id: 'relief', label: 'landmass relief', min: 0.6, max: 1.7, step: 0.05, default: 1 },
  { id: 'drift', label: 'continental drift', min: 0, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = {
  id: 'g14-strata-mass',
  name: 'g14 strata mass',
  params,
  create: () => new StrataMassRenderer(),
};

export default preset;
