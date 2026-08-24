/** g14-season-crown: Seasons palette theatre crossed with Solar Crown. */
import type { PresetParam, PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

const TAU = Math.PI * 2;
const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const BANKS = [186, 104, 318, 38];

function dominantDeck(frame: VisualizerFrameData) {
  const channel = (frame as VisualizerFrameData & { dominantChannel?: string | null }).dominantChannel;
  if (channel) return frame.decks.find((deck) => deck.channel === channel) ?? null;
  return frame.decks.reduce<VisualizerFrameData['decks'][number] | null>(
    (best, deck) => deck.playing && (!best || deck.level > best.level) ? deck : best,
    null
  );
}

class SeasonCrownRenderer implements PresetRenderer {
  private hue = 0.5;
  private bank = 0;
  private previousBank = 0;
  private sweep = 1;
  private lastSection: number | null = null;
  private polarity = 1;
  private flareAge = 9;
  private flareSeed = 0;
  private smoothDrop = 0;
  private smoothBuild = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    const tierBar = frame.beat ? frame.beat.ladderBarIndex ?? frame.beat.barIndex : null;
    const section = tierBar === null ? 0 : Math.floor(tierBar / 16);
    const deck = dominantDeck(frame);
    const genome = deck?.trackId == null ? 0 : mod(deck.trackId, BANKS.length);
    if (this.lastSection === null) {
      this.bank = genome;
      this.previousBank = this.bank;
      this.lastSection = section;
    } else if (section !== this.lastSection) {
      this.previousBank = this.bank;
      this.bank = mod(this.bank + 1 + mod(section + genome, 3), BANKS.length);
      this.sweep = 0;
      this.polarity *= -1;
      this.lastSection = section;
    }
    this.sweep = Math.min(1, this.sweep + dt * (frame.params.sweep ?? 1) * 0.8);
    this.hue += (frame.centroid - this.hue) * (1 - Math.exp(-dt / 1));

    const lowPresence = clamp((frame.bands.low - 0.2) / 0.5);
    const alpha = 1 - Math.exp(-dt / 0.35);
    this.smoothDrop += (frame.trend.excitement * lowPresence - this.smoothDrop) * alpha;
    this.smoothBuild += (frame.trend.excitement * (1 - lowPresence) - this.smoothBuild) * alpha;
    const sustained = clamp((frame.bands.low + frame.bands.mid + frame.bands.high) * 0.47);
    const ride = Math.max(this.smoothDrop, sustained);
    this.flareAge += dt;
    if (frame.impulse.low > 0.28 && this.flareAge > 0.13) {
      this.flareAge = 0;
      this.flareSeed = mod(frame.time * 0.618 + frame.impulse.low * 3.1, 1);
    }

    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const radius = unit * (0.16 + slow.low * 0.04) * (frame.params.scale ?? 1);
    const hueOffset = (this.hue - 0.5) * 240;
    const oldHue = mod(BANKS[this.previousBank] + hueOffset, 360);
    const newHue = mod(BANKS[this.bank] + hueOffset, 360);
    const activeHue = this.sweep < 0.5 ? oldHue : newHue;
    ctx.fillStyle = `hsl(${mod(activeHue + 180, 360)}, 80%, 3%)`;
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.25);
    gradient.addColorStop(0, `hsl(${mod(activeHue + 42, 360)}, 100%, ${55 + ride * 12}%)`);
    gradient.addColorStop(0.65, `hsl(${activeHue}, 100%, 48%)`);
    gradient.addColorStop(1, `hsl(${mod(activeHue - 30, 360)}, 100%, 18%)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 + frame.impulse.low * 0.06), 0, TAU);
    ctx.fill();

    const streamers = 18 + Math.floor(frame.spread * 18);
    ctx.lineCap = 'round';
    for (let i = 0; i < streamers; i++) {
      const a = (i / streamers) * TAU + frame.time * (0.03 + slow.mid * 0.08) * this.polarity;
      const sweepAngle = this.sweep * TAU - Math.PI;
      const passed = mod(a - sweepAngle, TAU) < Math.PI;
      const hue = passed ? newHue : oldHue;
      const len = radius * (0.22 + frame.bands.mid * 0.55 + this.smoothBuild * 0.35);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.quadraticCurveTo(
        cx + Math.cos(a + this.polarity * 0.18) * (radius + len * 0.65),
        cy + Math.sin(a + this.polarity * 0.18) * (radius + len * 0.65),
        cx + Math.cos(a) * (radius + len),
        cy + Math.sin(a) * (radius + len)
      );
      ctx.strokeStyle = `hsla(${mod(hue + i * 3, 360)}, 100%, 62%, ${0.18 + frame.bands.mid * 0.42})`;
      ctx.lineWidth = Math.max(1, unit * 0.0025);
      ctx.stroke();
    }

    if (this.flareAge < 1.1) {
      const life = this.flareAge / 1.1;
      const rise = Math.sin(life * Math.PI);
      const reach = radius * (0.45 + frame.impulse.low * 0.5) * rise * (frame.params.prominence ?? 1);
      for (let i = 0; i < 3; i++) {
        const a = this.flareSeed * TAU + i * TAU / 3;
        const x0 = cx + Math.cos(a - 0.32) * radius;
        const y0 = cy + Math.sin(a - 0.32) * radius;
        const x1 = cx + Math.cos(a + 0.32) * radius;
        const y1 = cy + Math.sin(a + 0.32) * radius;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(cx + Math.cos(a + this.polarity * 0.18) * (radius + reach), cy + Math.sin(a + this.polarity * 0.18) * (radius + reach), x1, y1);
        ctx.strokeStyle = `hsla(${mod(newHue + 50, 360)}, 100%, 76%, ${1 - life})`;
        ctx.lineWidth = unit * (0.006 + frame.impulse.low * 0.006);
        ctx.stroke();
      }
    }

    for (const d of frame.decks) {
      if (!d.playing || d.level < 0.02) continue;
      const side = d.channel === 'A' || d.channel === 'C' ? -1 : 1;
      const y = cy + (d.channel === 'C' || d.channel === 'D' ? radius * 0.55 : -radius * 0.55);
      ctx.strokeStyle = `hsla(${mod(newHue + side * 80, 360)}, 100%, 68%, ${clamp(d.level * d.fader)})`;
      ctx.lineWidth = unit * (0.002 + d.eq.high * 0.005);
      ctx.beginPath();
      ctx.moveTo(cx + side * radius, y);
      ctx.lineTo(cx + side * radius * (1.5 + d.eq.mid), y);
      ctx.stroke();
    }
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'crown scale', min: 0.65, max: 1.35, step: 0.05, default: 1 },
  { id: 'prominence', label: 'prominence reach', min: 0.4, max: 2, step: 0.05, default: 1 },
  { id: 'sweep', label: 'season sweep', min: 0.4, max: 2, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = {
  id: 'g14-season-crown',
  name: 'g14 season-crown',
  params,
  create: () => new SeasonCrownRenderer(),
};

export default preset;
