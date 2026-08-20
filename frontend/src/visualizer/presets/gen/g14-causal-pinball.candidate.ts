import type {
  PresetParam,
  PresetRenderer,
  VisualizerFrameData,
  VisualizerPreset,
} from '../types';

const TAU = Math.PI * 2;

function dominantTrackId(frame: VisualizerFrameData): number {
  const channel = (frame as VisualizerFrameData & { dominantChannel?: string | null })
    .dominantChannel;
  const selected = frame.decks.find((deck) => deck.channel === channel);
  if (selected?.trackId != null) return selected.trackId;
  let best = frame.decks[0];
  for (const deck of frame.decks) if (!best || deck.level > best.level) best = deck;
  return best?.trackId ?? 1401;
}

function randomStream(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) | 0;
    state = Math.imul(state ^ (state >>> 16), 0x45d9f3b) | 0;
    return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
  };
}

interface Bumper {
  x: number;
  y: number;
  band: number;
}

class CausalPinballRenderer implements PresetRenderer {
  private seed = 0;
  private bumpers: Bumper[] = [];
  private from = 0;
  private to = 1;
  private previousBeat = -1;
  private hit = -1;
  private hitLife = 0;
  private fallbackPhase = 0;

  private rebuild(seed: number): void {
    this.seed = seed;
    const random = randomStream(seed);
    this.bumpers = Array.from({ length: 7 }, (_, index) => ({
      x: 0.2 + random() * 0.6,
      y: 0.2 + (index % 3) * 0.19 + random() * 0.08,
      band: Math.floor(random() * 24),
    }));
    this.from = 0;
    this.to = 1;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: VisualizerFrameData
  ): void {
    const seed = dominantTrackId(frame);
    if (seed !== this.seed || this.bumpers.length === 0) this.rebuild(seed);
    const dt = Math.min(0.1, Math.max(0, frame.dt));
    const beat = frame.beat;
    this.fallbackPhase = (this.fallbackPhase + dt * 1.5) % 1;
    const phase = beat?.phase ?? this.fallbackPhase;
    const beatOrdinal = beat
      ? (beat.ladderBarIndex ?? beat.barIndex) * beat.beatsPerBar + beat.beatInBar
      : Math.floor(frame.time * 1.5);
    if (beatOrdinal !== this.previousBeat) {
      if (this.previousBeat >= 0) {
        this.from = this.to;
        this.to = (this.to + 1 + (frame.bands.mid > 0.48 ? 2 : 0)) % this.bumpers.length;
        this.hit = this.from;
        this.hitLife = 1;
      }
      this.previousBeat = beatOrdinal;
    }
    this.hitLife = Math.max(0, this.hitLife - dt * 2.6);

    const scale = frame.params.scale ?? 1;
    const ox = width * 0.18;
    const oy = height * 0.06;
    const tableW = width * 0.64;
    const tableH = height * 0.88;
    const hue = ((seed % 260) + 260) % 260;
    ctx.fillStyle = `hsl(${(hue + 210) % 360}, 65%, 5%)`;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.lineJoin = 'round';
    ctx.fillStyle = `hsl(${hue}, 70%, 10%)`;
    ctx.strokeStyle = `hsl(${(hue + 65) % 360}, 100%, 58%)`;
    ctx.lineWidth = Math.max(4, width * 0.006);
    ctx.beginPath();
    ctx.moveTo(tableW * 0.12, 0);
    ctx.lineTo(tableW * 0.88, 0);
    ctx.lineTo(tableW, tableH * 0.92);
    ctx.lineTo(tableW * 0.64, tableH);
    ctx.lineTo(tableW * 0.36, tableH);
    ctx.lineTo(0, tableH * 0.92);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 0.5;
    ctx.lineWidth *= 0.45;
    for (let i = 0; i < this.bumpers.length - 1; i++) {
      const a = this.bumpers[i];
      const b = this.bumpers[i + 1];
      ctx.beginPath();
      ctx.moveTo(a.x * tableW, a.y * tableH);
      ctx.lineTo(b.x * tableW, b.y * tableH);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < this.bumpers.length; i++) {
      const bumper = this.bumpers[i];
      const level = frame.spectrum[bumper.band] ?? 0;
      const struck = i === this.hit ? this.hitLife : 0;
      const radius = (tableW * (0.038 + 0.025 * level) * scale) * (1 + struck * 0.35);
      ctx.fillStyle = `hsl(${(hue + i * 42) % 360}, 100%, ${42 + struck * 35}%)`;
      ctx.strokeStyle = struck > 0 ? '#ffffff' : `hsl(${(hue + i * 42 + 35) % 360}, 100%, 72%)`;
      ctx.lineWidth = Math.max(3, radius * 0.18);
      ctx.beginPath();
      ctx.arc(bumper.x * tableW, bumper.y * tableH, radius, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }

    const a = this.bumpers[this.from];
    const b = this.bumpers[this.to];
    const travel = phase * phase * (3 - 2 * phase);
    const bx = (a.x + (b.x - a.x) * travel) * tableW;
    const by = (a.y + (b.y - a.y) * travel - Math.sin(travel * Math.PI) * 0.1) * tableH;
    const ballR = tableW * (0.024 + frame.bands.low * 0.012) * scale;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = `hsl(${(hue + 170) % 360}, 100%, 55%)`;
    ctx.shadowBlur = ballR * 1.8;
    ctx.beginPath();
    ctx.arc(bx, by, ballR, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;

    const flip = frame.impulse.low * tableW * 0.07;
    ctx.strokeStyle = `hsl(${(hue + 130) % 360}, 100%, 62%)`;
    ctx.lineWidth = tableW * 0.035;
    ctx.beginPath();
    ctx.moveTo(tableW * 0.2, tableH * 0.87);
    ctx.lineTo(tableW * 0.43, tableH * 0.82 - flip);
    ctx.moveTo(tableW * 0.8, tableH * 0.87);
    ctx.lineTo(tableW * 0.57, tableH * 0.82 - flip);
    ctx.stroke();
    ctx.restore();
  }
}

const params: PresetParam[] = [
  { id: 'scale', label: 'machine scale', min: 0.7, max: 1.5, step: 0.05, default: 1 },
];

const preset: VisualizerPreset = {
  id: 'g14-causal-pinball',
  name: 'g14 causal pinball',
  params,
  create: () => new CausalPinballRenderer(),
};

export default preset;
