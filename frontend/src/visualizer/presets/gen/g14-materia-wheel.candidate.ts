/** g14-materia-wheel: quantized matte materia with full-wheel spectral hue. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function dominantDeck(frame: VisualizerFrameData) {
  const channel = (frame as VisualizerFrameData & { dominantChannel?: string | null }).dominantChannel;
  if (channel) return frame.decks.find((deck) => deck.channel === channel) ?? null;
  let best: VisualizerFrameData['decks'][number] | null = null;
  for (const deck of frame.decks) {
    if (deck.playing && (!best || deck.level > best.level)) best = deck;
  }
  return best;
}

class MateriaWheelRenderer implements PresetRenderer {
  private hue = 0.52;
  private angle = 0;
  private lastBar: number | null = null;
  private bank = 0;
  private topology = 0;
  private genome = 0.5;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    this.hue += (frame.centroid - this.hue) * (1 - Math.exp(-dt / 1));
    this.angle += dt * (0.08 + slow.mid * 0.22) * (frame.params.motion ?? 1);

    const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
    if (tierBar !== null && tierBar !== this.lastBar) {
      if (this.lastBar !== null && mod(tierBar, 8) === 0) this.bank = mod(this.bank + 1, 4);
      if (this.lastBar !== null && mod(tierBar, 16) === 0) this.topology = 1 - this.topology;
      this.lastBar = tierBar;
    }

    const deck = dominantDeck(frame);
    if (deck?.trackId != null) this.genome = hash(deck.trackId);
    const barInPhrase = tierBar === null ? 3 : mod(tierBar, 8);
    const strata = Math.min(4, barInPhrase + 1);
    const energy = clamp((frame.bands.low + frame.bands.mid + frame.bands.high) / 2);
    const bassPresence = clamp((frame.bands.low - 0.2) / 0.5);
    const drop = frame.trend.excitement * bassPresence;
    const buildup = frame.trend.excitement * (1 - bassPresence);
    const baseHue = mod(this.hue * 360 + this.bank * 83 + this.genome * 47, 360);
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const scale = frame.params.scale ?? 1;
    const symmetry = 3 + Math.floor(this.genome * 6);

    ctx.fillStyle = `hsl(${mod(baseHue + 180, 360)}, 75%, 4%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle + this.topology * Math.PI / symmetry);

    for (let i = 23; i >= 0; i--) {
      const stratum = Math.floor(i / 6);
      if (stratum >= strata) continue;
      const level = clamp(frame.spectrum[i] ?? 0);
      const eq = i < 8 ? deck?.eq.low : i < 16 ? deck?.eq.mid : deck?.eq.high;
      const eqGain = eq == null ? 1 : clamp(0.2 + eq * 1.6, 0, 1.8);
      const a0 = (i / 24) * TAU - 0.055;
      const a1 = ((i + 1) / 24) * TAU + 0.055;
      const inner = unit * (0.08 + stratum * 0.047) * scale;
      const impulse = i < 8 ? frame.impulse.low : i < 16 ? frame.impulse.mid : frame.impulse.high;
      const outer = inner + unit * (0.035 + level * 0.17 * eqGain + impulse * 0.04) * scale;
      const hue = mod(baseHue + i * (360 / 24) + this.topology * 28, 360);
      const light = 38 + stratum * 5 + level * 20;
      ctx.beginPath();
      ctx.arc(0, 0, outer, a0, a1);
      ctx.arc(0, 0, inner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${hue}, 100%, ${light}%)`;
      ctx.fill();
      ctx.strokeStyle = `hsl(${mod(hue + 35, 360)}, 100%, ${Math.min(78, light + 18)}%)`;
      ctx.lineWidth = Math.max(1, unit * 0.0025 * (frame.params.relief ?? 1));
      ctx.stroke();
    }

    const kick = frame.impulse.low;
    const coreR = unit * (0.075 + frame.bands.low * 0.035 + kick * 0.025) * scale;
    ctx.beginPath();
    for (let i = 0; i <= symmetry * 2; i++) {
      const a = (i / (symmetry * 2)) * TAU;
      const r = coreR * (i % 2 === 0 ? 1 : 0.62 + frame.flatness * 0.18);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.fillStyle = `hsl(${mod(baseHue + 150, 360)}, 100%, ${48 + energy * 20}%)`;
    ctx.fill();

    if (kick > 0.05) {
      ctx.beginPath();
      ctx.arc(0, 0, unit * (0.24 + kick * 0.13), 0, TAU);
      ctx.strokeStyle = `hsla(${baseHue}, 100%, 72%, ${kick * 0.75})`;
      ctx.lineWidth = unit * 0.006;
      ctx.stroke();
    }
    ctx.restore();

    const phrasePhase = frame.beat && tierBar !== null ? (mod(tierBar, 8) + frame.beat.barPhase) / 8 : 0;
    ctx.fillStyle = `hsla(${baseHue}, 100%, 60%, ${0.12 + buildup * 0.18})`;
    ctx.fillRect(0, height - Math.max(2, height * 0.008), width * phrasePhase, Math.max(2, height * 0.008));
    if (drop > 0.1) {
      ctx.strokeStyle = `hsla(${mod(baseHue + 120, 360)}, 100%, 70%, ${drop * 0.45})`;
      ctx.lineWidth = unit * 0.004;
      ctx.strokeRect(width * 0.02, height * 0.02, width * 0.96, height * 0.96);
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'object scale', min: 0.6, max: 1.35, step: 0.05, default: 1 },
  { id: 'relief', label: 'facet relief', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'motion', label: 'wheel motion', min: 0.2, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = {
  id: 'g14-materia-wheel',
  name: 'g14 materia-wheel',
  params,
  create: () => new MateriaWheelRenderer(),
};

export default preset;
