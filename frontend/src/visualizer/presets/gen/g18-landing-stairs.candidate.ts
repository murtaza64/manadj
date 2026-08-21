import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function smooth(x: number): number { const t = clamp01(x); return t * t * (3 - 2 * t); }
function mod(x: number, n: number): number { return ((x % n) + n) % n; }
function seedOf(frame: VisualizerFrameData): number {
  return frame.decks.find((d) => d.channel === frame.dominantChannel)?.trackId ?? 404;
}

class LandingStairsRenderer implements PresetRenderer {
  private clock = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const slow = frame.bandsSlow ?? frame.bands;
    const fallbackHz = frame.beat?.bpm ? frame.beat.bpm / 60 : 1.2 + slow.mid * 0.8;
    this.clock += dt * fallbackHz;
    const beat = frame.beat;
    if (beat) {
      const tier = beat.ladderBarIndex ?? beat.barIndex;
      this.clock = tier * beat.beatsPerBar + beat.beatInBar + beat.phase;
    }
    const phase = beat?.phase ?? mod(this.clock, 1);
    const active = beat?.beatInBar ?? mod(Math.floor(this.clock), 4);
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : Math.floor(this.clock / 4);
    const phrase = Math.floor(tierBar / 4);
    const reverse = mod(phrase, 2) === 1;
    const anticipation = frame.params.anticipation ?? 0.68;
    const approach = smooth((phase - anticipation) / (1 - anticipation));
    const reboundRate = frame.params.rebound ?? 8;
    const rebound = phase * Math.exp(1 - phase * reboundRate) * reboundRate;
    const seed = seedOf(frame);
    const depth = frame.params.depth ?? 0.095;

    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height);
    const stairW = width * 0.15;
    const totalW = stairW * 4;
    const left = (width - totalW) / 2;
    const baseY = height * 0.78;

    for (let slot = 0; slot < 4; slot++) {
      const i = reverse ? 3 - slot : slot;
      const x = left + slot * stairW;
      const h = unit * (0.12 + i * depth + (frame.spectrum[i * 6] ?? 0) * 0.018);
      const hue = mod(seed * 13 + i * 76 + phrase * 23, 360);
      ctx.fillStyle = slot <= active ? `hsl(${hue}, 100%, 48%)` : '#263440';
      ctx.fillRect(x + unit * 0.006, baseY - h, stairW - unit * 0.012, h);
      ctx.fillStyle = slot <= active ? `hsl(${mod(hue + 25, 360)}, 100%, 68%)` : '#3b4a56';
      ctx.fillRect(x + unit * 0.006, baseY - h, stairW - unit * 0.012, unit * 0.018);
    }

    const targetSlot = phase < anticipation ? active : mod(active + 1, 4);
    const targetI = reverse ? 3 - targetSlot : targetSlot;
    const targetX = left + (targetSlot + 0.5) * stairW;
    const targetY = baseY - unit * (0.12 + targetI * depth + (frame.spectrum[targetI * 6] ?? 0) * 0.018);
    const sourceSlot = active;
    const sourceI = reverse ? 3 - sourceSlot : sourceSlot;
    const sourceX = left + (sourceSlot + 0.5) * stairW;
    const sourceY = baseY - unit * (0.12 + sourceI * depth + (frame.spectrum[sourceI * 6] ?? 0) * 0.018);
    // At phase zero the tile is flush; it waits, rebounds, then approaches late.
    const travel = phase < anticipation ? 0 : approach;
    const x = phase < anticipation ? sourceX : sourceX + (targetX - sourceX) * travel;
    const landingY = phase < anticipation ? sourceY : sourceY + (targetY - sourceY) * travel;
    const drive = Math.max(
      frame.regime?.sustained ?? 0,
      frame.regime?.dropTransition ?? 0,
      frame.trend.excitement * 0.25
    );
    const lift = phase < anticipation
      ? rebound * unit * 0.08
      : Math.sin(travel * Math.PI) * unit * (0.16 + drive * 0.06);
    const compression = rebound * frame.impulse.low * unit * 0.025;
    const tileW = stairW * 0.58;
    const tileH = unit * 0.07 - compression;
    const hue = mod(seed * 13 + targetI * 76 + phrase * 23, 360);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - tileW / 2, landingY - tileH - lift + compression, tileW, tileH);
    ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
    ctx.fillRect(x - tileW * 0.38, landingY - tileH * 0.7 - lift + compression, tileW * 0.76, tileH * 0.18);

    const phrasePhase = (mod(tierBar, 4) + (beat?.barPhase ?? mod(this.clock / 4, 1))) / 4;
    ctx.strokeStyle = `hsl(${mod(seed * 13 + phrase * 23, 360)}, 100%, 58%)`;
    ctx.lineWidth = unit * 0.012;
    ctx.beginPath();
    ctx.moveTo(width * 0.15, height * 0.9);
    ctx.lineTo(width * (0.15 + 0.7 * phrasePhase), height * 0.9);
    ctx.stroke();
  }
}

const preset: VisualizerPreset = {
  id: 'g18-landing-stairs', name: 'g18 landing stairs',
  params: [
    { id: 'anticipation', label: 'late approach', min: 0.5, max: 0.84, step: 0.01, default: 0.68 },
    { id: 'rebound', label: 'rebound speed', min: 4, max: 14, step: 0.5, default: 8 },
    { id: 'depth', label: 'stair depth', min: 0.05, max: 0.14, step: 0.005, default: 0.095 },
  ],
  create: () => new LandingStairsRenderer(),
};
export default preset;
