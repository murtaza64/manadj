import type { PresetRenderer, VisualizerFrameData, VisualizerPreset } from '../types';

function mod(x: number, n: number): number { return ((x % n) + n) % n; }
function seedOf(frame: VisualizerFrameData): number {
  return frame.decks.find((d) => d.channel === frame.dominantChannel)?.trackId ?? 135;
}

class OffbeatRelayRenderer implements PresetRenderer {
  private clock = 0;

  render(ctx: CanvasRenderingContext2D, width: number, height: number, frame: VisualizerFrameData): void {
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const fallbackHz = frame.beat?.bpm ? frame.beat.bpm / 60 : 2;
    this.clock += dt * fallbackHz;
    const beat = frame.beat;
    if (beat) {
      const tier = beat.ladderBarIndex ?? beat.barIndex;
      this.clock = tier * beat.beatsPerBar + beat.beatInBar + beat.phase;
    }
    const phase = beat?.phase ?? mod(this.clock, 1);
    const active = beat?.beatInBar ?? mod(Math.floor(this.clock), 4);
    const tierBar = beat ? (beat.ladderBarIndex ?? beat.barIndex) : Math.floor(this.clock / 4);
    const seed = seedOf(frame);
    const relayGap = frame.params.relayGap ?? 0.2;
    const topHit = Math.exp(-phase * 9);
    const bottomHit = Math.exp(-Math.pow((phase - 0.5) * 10, 2)) * (0.45 + frame.impulse.mid * 0.55);
    const exchange = 0.75 - 0.25 * Math.cos(phase * Math.PI * 2);
    const drive = Math.max(frame.regime?.sustained ?? 0, frame.regime?.dropTransition ?? 0);

    ctx.fillStyle = '#070d14';
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height);
    const left = width * 0.12;
    const span = width * 0.76;
    const bayW = span / 4;
    let stereoWidth = 0;
    if (frame.wave && frame.wave.left.length > 0) {
      const stride = Math.max(1, Math.floor(frame.wave.left.length / 32));
      for (let i = 0; i < frame.wave.left.length; i += stride) {
        stereoWidth += Math.abs(frame.wave.left[i] - frame.wave.right[i]);
      }
      stereoWidth = Math.min(1, stereoWidth / 16);
    }
    const topY = height * (0.37 - relayGap * (0.12 + stereoWidth * 0.1));
    const bottomY = height * (0.63 + relayGap * (0.12 + stereoWidth * 0.1));
    const c1 = `hsl(${mod(seed * 29, 360)}, 100%, 55%)`;
    const c2 = `hsl(${mod(seed * 29 + 145, 360)}, 100%, 56%)`;

    for (let i = 0; i < 4; i++) {
      const x = left + i * bayW;
      ctx.fillStyle = i < active ? '#1e4050' : '#16202b';
      ctx.fillRect(x + unit * 0.008, height * 0.23, bayW - unit * 0.016, height * 0.54);
      ctx.fillStyle = i === active ? c1 : '#3a4652';
      ctx.fillRect(x + bayW * 0.12, topY - unit * 0.018, bayW * 0.76, unit * 0.036);
      ctx.fillStyle = i === active ? c2 : '#3a4652';
      ctx.fillRect(x + bayW * 0.12, bottomY - unit * 0.018, bayW * 0.76, unit * 0.036);
    }

    const dominant = frame.decks.find((d) => d.channel === frame.dominantChannel);
    const eq = dominant?.eq ?? { low: 0.5, mid: 0.5, high: 0.5 };
    const doubled = frame.decks.some((a, i) => a.trackId != null && frame.decks.some((b, j) => j > i && b.trackId === a.trackId));
    for (let i = 0; i < 24; i++) {
      const level = frame.spectrum[i] ?? 0;
      ctx.globalAlpha = 0.18 + level * 0.45 + frame.impulse.high * 0.1;
      ctx.fillStyle = doubled ? '#ffffff' : (i < 8 ? c1 : c2);
      const eqGain = i < 8 ? eq.low : i < 16 ? eq.mid : eq.high;
      ctx.fillRect(left + i * span / 24, height * 0.19, Math.max(2, span / 48), unit * (0.008 + level * eqGain * 0.018));
    }
    ctx.globalAlpha = 1;

    const centerX = left + (active + 0.5) * bayW;
    const batonR = unit * (frame.params.batonSize ?? 0.035);
    const batonY = topY + (bottomY - topY) * exchange;
    ctx.fillStyle = phase < 0.5 ? c1 : c2;
    ctx.beginPath();
    ctx.arc(centerX, batonY, batonR * (1 + frame.impulse.low * 0.4), 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = unit * 0.012;
    ctx.strokeStyle = c1;
    ctx.beginPath();
    ctx.moveTo(left, topY);
    ctx.lineTo(centerX - bayW * 0.35 + bayW * 0.7 * phase, topY - topHit * unit * 0.045);
    ctx.stroke();
    ctx.strokeStyle = c2;
    ctx.beginPath();
    ctx.moveTo(width - left, bottomY);
    ctx.lineTo(centerX + bayW * 0.35 - bayW * 0.7 * phase, bottomY + bottomHit * unit * 0.045);
    ctx.stroke();

    const pulseWidth = unit * (0.04 + drive * 0.025);
    ctx.fillStyle = c1;
    ctx.fillRect(centerX - pulseWidth / 2, topY - unit * 0.055 * topHit, pulseWidth, unit * 0.11 * topHit);
    ctx.fillStyle = c2;
    ctx.fillRect(centerX - pulseWidth / 2, bottomY - unit * 0.055 * bottomHit, pulseWidth, unit * 0.11 * bottomHit);

    const barPhase = beat?.barPhase ?? mod(this.clock / 4, 1);
    const ticks = Math.max(1, Math.round(frame.params.trailCount ?? 8));
    for (let i = 0; i < ticks; i++) {
      const age = mod(barPhase - i / ticks, 1);
      ctx.globalAlpha = 0.12 + 0.45 * (1 - age);
      ctx.fillStyle = i % 2 ? c2 : c1;
      ctx.fillRect(left + age * span, height * 0.84, Math.max(2, unit * 0.008), unit * 0.018);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = `hsla(${mod(seed * 29 + Math.floor(tierBar / 16) * 61, 360)}, 100%, 55%, 0.35)`;
    for (const deck of frame.decks) {
      ctx.fillRect(
        left,
        height * (0.91 + frame.decks.indexOf(deck) * 0.012),
        span * deck.level,
        unit * (0.003 + deck.fader * 0.006)
      );
    }
  }
}

const preset: VisualizerPreset = {
  id: 'g18-offbeat-relay', name: 'g18 offbeat relay',
  params: [
    { id: 'relayGap', label: 'voice separation', min: 0.05, max: 0.42, step: 0.01, default: 0.2 },
    { id: 'batonSize', label: 'baton size', min: 0.018, max: 0.07, step: 0.002, default: 0.035 },
    { id: 'trailCount', label: 'meter ticks', min: 4, max: 16, step: 1, default: 8 },
  ],
  wantsWave: true,
  create: () => new OffbeatRelayRenderer(),
};
export default preset;
