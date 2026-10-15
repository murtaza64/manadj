/**
 * TRANS + ROLL kernel (#360): the pure per-sample engine behind the Beat FX
 * repeat worklet (beatFxRepeatProcessor.ts). Main-thread-free and
 * allocation-free in process(), so it is unit-testable in node.
 *
 * Both effects are phase-locked to a beat clock (frame → beat coordinate)
 * the Mixer posts from the target Deck's Beatgrid:
 *
 * - TRANS: a gate on each `beats`-long grid cell — open for `duty` of the
 *   cell, with a linear `slope` on both edges (declick). Output is
 *   in × (dry + wet × gate): partial depth = partial duck. No tail.
 * - ROLL: the input is recorded into a ring continuously. On engage the
 *   loop region is the last complete `beats`-cell ending at the most
 *   recent grid boundary (so playback is immediately in phase: the read
 *   point is "now − length"); without enough history it falls back to the
 *   forward cell [boundary, boundary + length) — live until the first wrap.
 *   Ring writes freeze once the region (plus a seam continuation) is in, so
 *   the region is never overwritten while rolling. Each wrap crossfades the
 *   audio past the region end into the region start (seam declick).
 *   A length change while rolling re-slices the captured audio: shorter
 *   keeps the start, longer keeps the end (older audio from the ring), with
 *   a crossfade from the old read. Release ramps back to live; no tail.
 */

export type RepeatMode = 'off' | 'trans' | 'roll';

export interface RepeatState {
  mode: RepeatMode;
  /** Cell length in beats (the shared BEAT ◄ ► value). */
  beats: number;
  /** Replacement-effect mix gains (beatFx.ts replacementMixGains). */
  dry: number;
  wet: number;
}

export interface RepeatSettings {
  transDuty: number;
  transSlopeMs: number;
  rollFadeMs: number;
}

/** Beat coordinate `beat` at absolute frame `frame`; `beatFrames` frames
 * per beat. `beat === null` = tempo only (no grid phase known). */
export interface RepeatClock {
  frame: number;
  beat: number | null;
  beatFrames: number;
}

/** Ring length: the longest ROLL plus re-slice headroom. */
export const REPEAT_RING_SECONDS = 10;
/** Linear slew for engage/release and LEVEL/DEPTH changes. */
const DECLICK_S = 0.005;
/** Re-anchor tolerance: smaller clock discrepancies are jitter, ignored. */
const CLOCK_JUMP_BEATS = 0.02;
const CLOCK_TEMPO_TOLERANCE = 0.001;

/** TRANS gate value [0, 1] at `x` frames into a `cell`-frame cell. */
export function transGate(x: number, cell: number, duty: number, slope: number): number {
  const on = Math.max(0, Math.min(1, duty)) * cell;
  const s = Math.max(1, Math.min(slope, on / 2, (cell - on) / 2));
  if (x < s) return x / s;
  if (x < on) return 1;
  if (x < on + s) return 1 - (x - on) / s;
  return 0;
}

export class RepeatKernel {
  readonly sampleRate: number;
  private readonly cap: number;
  private readonly ringL: Float32Array;
  private readonly ringR: Float32Array;
  /** Absolute frame of the oldest valid ring sample (gaps reset it). */
  private historyStart = 0;
  /** One past the last absolute frame written. */
  private writtenUntil = 0;

  private state: RepeatState = { mode: 'off', beats: 1, dry: 1, wet: 0 };
  private settings: RepeatSettings = { transDuty: 0.5, transSlopeMs: 3, rollFadeMs: 4 };
  private clock: { frame: number; beat: number; beatFrames: number } | null = null;

  private dry = 1;
  private wet = 0;
  private transEngaged = 0;
  private rollEngaged = 0;

  private roll: {
    start: number;
    length: number;
    /** Writes stop at this frame (region end + seam continuation). */
    freezeAt: number;
  } | null = null;
  private rollFrom: { start: number; length: number; remaining: number; total: number } | null = null;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.cap = Math.ceil(REPEAT_RING_SECONDS * sampleRate);
    this.ringL = new Float32Array(this.cap);
    this.ringR = new Float32Array(this.cap);
  }

  setSettings(settings: RepeatSettings): void {
    this.settings = { ...settings };
  }

  /** Accept a clock unless it only differs by jitter from the current one. */
  setClock(next: RepeatClock): void {
    if (!(next.beatFrames > 0)) return;
    const current = this.clock;
    if (next.beat === null) {
      // Tempo only: keep the phase at next.frame, adopt the new tempo.
      const beat = current ? this.beatAt(next.frame) : 0;
      this.clock = { frame: next.frame, beat, beatFrames: next.beatFrames };
      return;
    }
    if (current) {
      const predicted = this.beatAt(next.frame);
      const sameTempo = Math.abs(next.beatFrames / current.beatFrames - 1) < CLOCK_TEMPO_TOLERANCE;
      if (sameTempo && Math.abs(predicted - next.beat) < CLOCK_JUMP_BEATS) return;
    }
    this.clock = { frame: next.frame, beat: next.beat, beatFrames: next.beatFrames };
  }

  /** Apply at `frame` (the next frame process() will render). */
  setState(next: RepeatState, frame: number): void {
    const previous = this.state;
    this.state = { ...next, beats: Math.max(1 / 64, next.beats) };
    if (next.mode === 'roll') {
      if (previous.mode !== 'roll' || !this.roll) this.engageRoll(frame);
      else if (Math.abs(next.beats - previous.beats) > 1e-9) this.resliceRoll(frame, next.beats);
    }
  }

  getState(): Readonly<RepeatState> {
    return this.state;
  }

  /** True while any effect is audible (engaged or ramping out). */
  get active(): boolean {
    return this.transEngaged > 0 || this.rollEngaged > 0 || this.state.mode !== 'off';
  }

  get rollRegion(): Readonly<{ start: number; length: number }> | null {
    return this.roll;
  }

  private ensureClock(frame: number): { frame: number; beat: number; beatFrames: number } {
    if (!this.clock) this.clock = { frame, beat: 0, beatFrames: this.sampleRate / 2 };
    return this.clock;
  }

  private beatAt(frame: number): number {
    const c = this.clock!;
    return c.beat + (frame - c.frame) / c.beatFrames;
  }

  private fadeFrames(length: number): number {
    return Math.max(1, Math.min(this.settings.rollFadeMs * this.sampleRate / 1000, length / 4));
  }

  private valid(frame: number): boolean {
    return frame >= this.historyStart && frame < this.writtenUntil && frame >= this.writtenUntil - this.cap;
  }

  private engageRoll(frame: number): void {
    const clock = this.ensureClock(frame);
    const beats = this.state.beats;
    const length = Math.min(beats * clock.beatFrames, this.cap / 2);
    const boundaryBeat = Math.floor(this.beatAt(frame) / beats + 1e-9) * beats;
    const boundary = clock.frame + (boundaryBeat - clock.beat) * clock.beatFrames;
    // Backward: the last complete cell. Forward fallback when the ring does
    // not reach back that far (fresh start, or a gap after a previous roll).
    const backward = boundary - length;
    const cell = beats * clock.beatFrames;
    const start = this.valid(Math.floor(backward)) ? backward
      : boundary >= this.historyStart ? boundary : boundary + cell;
    this.roll = { start, length, freezeAt: start + length + this.fadeFrames(length) };
    this.rollFrom = null;
  }

  private resliceRoll(frame: number, beats: number): void {
    const roll = this.roll!;
    const clock = this.ensureClock(frame);
    const length = Math.min(beats * clock.beatFrames, this.cap / 2);
    const end = roll.start + roll.length;
    // Shorter keeps the start; longer keeps the end and needs the older
    // audio still in the ring.
    const start = length <= roll.length ? roll.start : end - length;
    if (length > roll.length && !this.valid(Math.floor(start))) return;
    const fade = this.fadeFrames(Math.min(length, roll.length));
    this.rollFrom = { start: roll.start, length: roll.length, remaining: fade, total: fade };
    this.roll = { start, length, freezeAt: Math.max(roll.freezeAt, start + length + this.fadeFrames(length)) };
  }

  private ringAt(frame: number, channel: Float32Array): number {
    const index = Math.floor(frame);
    if (!this.valid(index)) return 0;
    return channel[((index % this.cap) + this.cap) % this.cap];
  }

  /** Loop read for `region` at absolute frame `frame`, with the seam fade. */
  private loopSample(region: { start: number; length: number }, frame: number, channel: Float32Array): number {
    // Before / during the first pass of a forward region: live.
    if (frame < region.start) return this.ringAt(frame, channel);
    const p = (((frame - region.start) % region.length) + region.length) % region.length;
    const fade = this.fadeFrames(region.length);
    const head = this.ringAt(region.start + p, channel);
    // First pass (before any wrap) plays straight through.
    if (p >= fade || frame - region.start < region.length) return head;
    const a = p / fade;
    return a * head + (1 - a) * this.ringAt(region.start + region.length + p, channel);
  }

  /**
   * Render one block. `frame` = absolute frame of the block's first sample
   * (worklet `currentFrame`). Inputs may alias outputs.
   */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frame: number): void {
    const n = inL.length;
    const step = 1 / Math.max(1, DECLICK_S * this.sampleRate);
    const { mode, dry: dryTarget, wet: wetTarget, beats } = this.state;
    const transTarget = mode === 'trans' ? 1 : 0;
    const rollTarget = mode === 'roll' ? 1 : 0;
    const clock = mode === 'trans' ? this.ensureClock(frame) : this.clock;
    const cell = clock ? beats * clock.beatFrames : 0;
    const slope = this.settings.transSlopeMs * this.sampleRate / 1000;
    for (let i = 0; i < n; i++) {
      const f = frame + i;
      const l = inL[i];
      const r = inR[i];
      // Record (a frozen roll region is never overwritten).
      if (!this.roll || f < this.roll.freezeAt) {
        if (f !== this.writtenUntil) this.historyStart = f; // gap
        const index = f % this.cap;
        this.ringL[index] = l;
        this.ringR[index] = r;
        this.writtenUntil = f + 1;
      }
      this.dry += Math.max(-step, Math.min(step, dryTarget - this.dry));
      this.wet += Math.max(-step, Math.min(step, wetTarget - this.wet));
      this.transEngaged += Math.max(-step, Math.min(step, transTarget - this.transEngaged));
      this.rollEngaged += Math.max(-step, Math.min(step, rollTarget - this.rollEngaged));

      let gain = 1;
      if (this.transEngaged > 0 && clock && cell > 0) {
        const beat = clock.beat + (f - clock.frame) / clock.beatFrames;
        const cells = beat / beats;
        const x = (cells - Math.floor(cells)) * cell;
        const gate = transGate(x, cell, this.settings.transDuty, slope);
        gain = 1 - this.transEngaged + this.transEngaged * (this.dry + this.wet * gate);
      }
      let yL = l * gain;
      let yR = r * gain;

      if (this.roll && this.rollEngaged > 0) {
        let rL = this.loopSample(this.roll, f, this.ringL);
        let rR = this.loopSample(this.roll, f, this.ringR);
        const from = this.rollFrom;
        if (from) {
          const a = from.remaining / from.total;
          rL = (1 - a) * rL + a * this.loopSample(from, f, this.ringL);
          rR = (1 - a) * rR + a * this.loopSample(from, f, this.ringR);
          if (--from.remaining <= 0) this.rollFrom = null;
        }
        const e = this.rollEngaged;
        yL = (1 - e) * yL + e * (this.dry * yL + this.wet * rL);
        yR = (1 - e) * yR + e * (this.dry * yR + this.wet * rR);
      } else if (this.roll && this.rollEngaged <= 0 && rollTarget === 0) {
        // Fully released: drop the region, resume recording (gap marked above).
        this.roll = null;
        this.rollFrom = null;
      }
      outL[i] = yL;
      outR[i] = yR;
    }
  }
}
