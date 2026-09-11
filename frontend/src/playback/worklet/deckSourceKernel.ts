/**
 * DeckSourceKernel — pure resample/position bookkeeping for the deck-source
 * worklet (ADR 0018). No Web Audio, no globals: samples in, frames out, so
 * the whole thing runs under vitest (ADR 0002).
 *
 * Model: one `live` voice plus a short list of fading tails. Any start/stop
 * retires the live voice into a declick fade-out, so a cue-stab restart is
 * an internal splice (old tail under the new fade-in) — the same overlap
 * the retired one-envelope-per-source AudioBufferSourceNode path produced
 * (rapid stabs each keep their own ≤5ms tail), and the machinery the
 * stretch-mode toggle crossfade (issue 03) will reuse.
 *
 * Voices capture their track's channel data, so a declick tail keeps
 * sounding the old track even across a Load's setTrack.
 *
 * Resampling is linear interpolation — parity with Blink's
 * AudioBufferSourceNode. At rate 1.0 and integer positions the interpolation
 * degenerates to a direct sample read and the fade-in gain to exactly 1, so
 * unity playback is bit-perfect (Key Lock off costs nothing).
 *
 * Stretch mode (Key Lock, issue 03): the live voice renders through a
 * StretchEngine behind a pure seam; position bookkeeping stays the kernel's
 * (advance rate × srRatio per frame), so the engine anchor math holds in
 * both modes. There is ONE stretcher instance, so fading tails always
 * render via the resample path (Mixxx-style) — during the ≤5ms declick the
 * pitch difference is masked. A mode switch is the same splice as a stab,
 * at the live voice's own (audible) position.
 */

import type { LoopFrames, SourceMode } from './protocol';
import { SingleTrackSource, StemTrackSource } from './trackSource';
import type { TrackSource } from './trackSource';
import { scratchPosition, scratchRate, scratchGain, scratchTravel } from './scratchMotion';
import type { ScratchMotion, ScheduledScratchFrame } from './scratchMotion';

/** The worklet-internal stretcher seam (ADR 0018): feed samples, set rate,
 * transpose fixed at none. `render` fills `frames` of output whose audible
 * start is `positionFrames`, advancing at `rate`; the engine reads its own
 * read-ahead window from `channels` (track and context sample rates equal —
 * the kernel falls back to resample otherwise). With `loop` set, window
 * reads at/past the region end fold back to its start (looping 03): the
 * stretcher hears the wrapped signal and smooths the wrap itself. */
export interface StretchEngine {
  readonly ready: boolean;
  /** Prime for a fresh voice (start/stab/mode-switch): reset internal
   * state, then warm it with the track's own history ending at
   * `positionFrames`, output discarded (stab-declick 01). A bare reset
   * ramps output 3%→100% over ~60 ms (zeroed overlap-add state) — the
   * "empty stab"; skipping reset instead bled audible residue of the
   * previous position. Warm-primed reset gives full onset energy
   * (−0.3 dB in the first 10 ms, probe-measured) with only the track's
   * genuine pre-cue context in the OLA state. */
  prime(
    source: TrackSource,
    positionFrames: number,
    rate: number,
    loop: LoopFrames | null
  ): void;
  render(
    out: Float32Array[],
    frames: number,
    source: TrackSource,
    positionFrames: number,
    rate: number,
    loop: LoopFrames | null
  ): void;
}

interface Voice {
  source: TrackSource;
  /** Track-frames advanced per output frame at rate 1 (trackSR / outputSR). */
  srRatio: number;
  /** Position in track frames (fractional). */
  position: number;
  /** Output frames rendered since start (drives the fade-in envelope). */
  age: number;
  /** Fade-in length for THIS voice (stab-declick 01): user starts/stabs
   * use the short attack (a kick's transient survives); loop-wrap and
   * mode-switch splice voices keep the full declick so their equal-gain
   * crossfade with the correlated retiring tail still sums to unity. */
  attackFrames: number;
  /** Fade-out state; null while live. Gain falls linearly from g0 over
   * declickFrames of fade age. */
  fade: { g0: number; age: number; samples?: number[] } | null;
  startId: number;
  mode: SourceMode;
}

interface PreparedScratchFrame extends ScheduledScratchFrame {
  voice: Voice;
  tail: NonNullable<Voice['fade']>;
  samples: number[];
  correction: number[];
  loopFrames: LoopFrames | null;
}

/** Tails are ≤ declick (5ms) long; more simultaneous ones than this means
 * starts are streaming faster than 1.6ms apart — drop the oldest. */
const MAX_FADING_VOICES = 3;

export class DeckSourceKernel {
  private track: { source: TrackSource; srRatio: number } | null = null;
  private live: Voice | null = null;
  private fading: Voice[] = [];
  private readonly declickFrames: number;
  /** Start/stab attack length; ≤ declickFrames (stab-declick 01). */
  private readonly attackFrames: number;
  /** Active loop region in track frames (looping 03), or null. */
  private loop: LoopFrames | null = null;

  private mode: SourceMode = 'resample';
  private stretchEngine: StretchEngine | null = null;
  /** Voice the stretcher was last primed for — one warm prime per voice
   * (stab-declick 01; see StretchEngine.prime). */
  private primedVoice: Voice | null = null;
  /** Block scratch for stretch output (gain applied per frame by the kernel). */
  private scratch: Float32Array[] = [];
  private platter: ScratchMotion | null = null;
  private platterGain = 0;
  private outputFrame = 0;
  private pendingStartTime: number | null = null;
  private platterExpectedPosition: number | null = null;
  private platterLastSamples: number[] = [];
  private platterCorrection: number[] = [];
  private platterSpliceFrames = 0;
  private scheduled: PreparedScratchFrame[] = [];
  private scheduledIndex = 0;
  private outputChannels = 2;

  constructor(declickFrames: number, attackFrames: number = declickFrames) {
    this.declickFrames = Math.max(1, declickFrames);
    // 0 = instant unity on starts/stabs (stab-declick 01).
    this.attackFrames = Math.max(0, Math.min(attackFrames, this.declickFrames));
  }

  /** Hand over a track's channel data. Future starts read the new track;
   * an in-flight declick tail keeps its captured old data. */
  setTrack(channels: Float32Array[], srRatio: number): void {
    this.cancelScratchSchedule();
    this.track = { source: new SingleTrackSource(channels), srRatio };
    this.outputChannels = Math.max(2, channels.length);
  }

  /** Hand over a track's stems (stems #209): `stems[s]` is one stem's
   * channel data. Reads mix the stems with per-stem gains (unity on load)
   * before either render path — one stretcher, sample-locked stems. */
  setStems(stems: Float32Array[][], srRatio: number): void {
    this.cancelScratchSchedule();
    this.track = { source: new StemTrackSource(stems), srRatio };
    this.outputChannels = Math.max(2, stems[0]?.length ?? 0);
  }

  /** Target per-stem gains, declick-ramped from the live voice's current
   * position (output time while scratching). A
   * single-source track ignores this. Gains live on the track source, so
   * a later start() (same Load) keeps the kill state; a new load resets. */
  setStemGains(gains: number[]): void {
    const source = this.track?.source;
    if (!(source instanceof StemTrackSource)) return;
    const atFrame = this.platter ? this.outputFrame : this.live?.position ?? 0;
    const ramp = this.live ? this.declickFrames * (this.platter ? 1 : this.live.srRatio) : 0;
    for (let s = 0; s < Math.min(gains.length, source.stemCount); s++) {
      source.setGain(s, gains[s], atFrame, ramp);
    }
  }

  setStretchEngine(engine: StretchEngine | null): void {
    this.stretchEngine = engine;
  }

  /**
   * Active loop (looping 03): while set, a live voice crossing `endFrames`
   * from inside the region wraps back by the region length — a declick
   * splice, identical in both modes. Wrap takes precedence over
   * end-of-track inside the region; a voice outside the region never
   * wraps. Degenerate regions clear.
   */
  setLoop(region: LoopFrames | null): void {
    this.loop = region && region.endFrames > region.startFrames ? region : null;
  }

  /** Key Lock. Mid-play, splice into the new mode at the live voice's own
   * position: the retired tail fades under the new voice's fade-in — same
   * machinery as a stab, so no click and no position jump. */
  setMode(mode: SourceMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (this.platter) return;
    const live = this.live;
    if (!live) return;
    const { source, srRatio, position, startId } = live;
    this.retireLive();
    // Full-declick attack: equal-gain crossfade with the correlated tail.
    this.live = {
      source,
      srRatio,
      position,
      age: 0,
      attackFrames: this.declickFrames,
      fade: null,
      startId,
      mode,
    };
  }

  /** (Re)start at a track frame. A running voice is retired into the
   * declick fade — the splice that keeps stabs click-free. The new voice
   * uses the SHORT attack (stab-declick 01): stab content is uncorrelated
   * with the retiring tail, so the punchy attack wins over exact
   * equal-gain summing. */
  start(positionFrames: number, startId: number, when?: number, preserveSchedule = false, prepared?: PreparedScratchFrame): void {
    if (!preserveSchedule) this.cancelScratchSchedule();
    if (!this.track) return;
    this.clearPlatter(prepared?.tail);
    let scratchHandover = false;
    for (const voice of this.fading) if (voice.fade?.samples !== undefined) scratchHandover = true;
    this.pendingStartTime = when ?? null;
    // Stem gain ramps are declick devices anchored at their change
    // position — settle them on every (re)start so a seek before the kill
    // point can't resurrect a killed stem (stems #210 review). The splice
    // itself declicks the restart.
    if (this.track.source instanceof StemTrackSource) this.track.source.settleGains();
    this.retireLive(prepared?.tail);
    const length = this.track.source.length;
    this.live = prepared?.voice ?? {
      source: this.track.source,
      srRatio: this.track.srRatio,
      position: Math.max(0, Math.min(positionFrames, length)),
      age: 0,
      attackFrames: scratchHandover ? this.declickFrames : this.attackFrames,
      fade: null,
      startId,
      mode: this.mode,
    };
    if (prepared) {
      this.live.position = Math.max(0, Math.min(positionFrames, length));
      this.live.startId = startId;
      this.live.mode = this.mode;
      this.live.attackFrames = scratchHandover ? this.declickFrames : this.attackFrames;
    }
  }

  /** Frames in the voice's own track. */
  private static lengthOf(voice: Voice): number {
    return voice.source.length;
  }

  /** Declick-fade to silence. Idempotent. */
  stop(preserveSchedule = false, tail?: NonNullable<Voice['fade']>): void {
    if (!preserveSchedule) this.cancelScratchSchedule();
    this.pendingStartTime = null;
    this.clearPlatter(tail);
    this.retireLive(tail);
  }

  /** A timestamped trajectory replaces motion without restarting the voice. */
  setScratch(motion: ScratchMotion, preserveSchedule = false, prepared?: PreparedScratchFrame): void {
    if (!preserveSchedule) this.cancelScratchSchedule();
    if (!this.track) return;
    this.pendingStartTime = null;
    if (!this.platter) {
      this.retireLive(prepared?.tail);
      this.live = prepared?.voice ?? { source: this.track.source, srRatio: this.track.srRatio,
        position: 0, age: 0, attackFrames: 0, fade: null, startId: -1, mode: 'resample' };
      this.platterGain = 0;
      this.platterExpectedPosition = null;
      this.platterLastSamples = prepared?.samples ?? [];
      this.platterCorrection = prepared?.correction ?? [];
      this.platterSpliceFrames = 0;
      if (this.track.source instanceof StemTrackSource) this.track.source.setOutputClock(this.outputFrame);
    }
    this.platter = motion;
  }

  private clearPlatter(tail?: NonNullable<Voice['fade']>): void {
    if (!this.platter) return;
    if (this.live) {
      // Fade the last audible sample, including any loop-splice correction;
      // extrapolating a reverse tail could cross an edge and click on release.
      if (tail) {
        tail.g0 = this.platterGain;
        tail.age = 0;
        for (let c = 0; c < this.outputChannels; c++) tail.samples![c] = this.platterLastSamples[c] ?? 0;
        this.live.fade = tail;
      } else this.live.fade = { g0: this.platterGain, age: 0, samples: this.platterLastSamples.slice() };
      this.fading.push(this.live);
      this.live = null;
    }
    if (this.track?.source instanceof StemTrackSource) this.track.source.setOutputClock(null);
    this.platter = null;
    this.platterGain = 0;
    while (this.fading.length > MAX_FADING_VOICES) this.fading.shift();
  }

  /** Track-frame position of the live voice, or null when stopped. */
  get livePositionFrames(): number | null {
    return this.live?.position ?? null;
  }

  scheduleScratch(frames: ScheduledScratchFrame[]): void {
    if (!this.track) return;
    const track = this.track;
    this.scratchFor(this.outputChannels, 128);
    this.scheduled = frames.map(frame => ({ ...frame,
      voice: { source: track.source, srRatio: track.srRatio, position: 0, age: 0,
        attackFrames: 0, fade: null, startId: -1, mode: 'resample' },
      tail: { g0: 0, age: 0, samples: new Array<number>(this.outputChannels).fill(0) },
      samples: new Array<number>(this.outputChannels).fill(0),
      correction: new Array<number>(this.outputChannels).fill(0),
      loopFrames: frame.loop ? { startFrames: 0, endFrames: 0 } : null,
    }));
    this.scheduledIndex = 0;
  }

  cancelScratchSchedule(): void {
    this.scheduled = [];
    this.scheduledIndex = 0;
  }

  /**
   * Render one block. `out` is zeroed and filled; `rates` is the composed
   * rate as an a-rate AudioParam array (length 1 or one-per-frame).
   * Returns the startId of a live voice that ran off the end of its track
   * this block, or null.
   */
  render(out: Float32Array[], rates: Float32Array, now = 0, outputSampleRate = 48000): number | null {
    if (this.scheduledIndex >= this.scheduled.length) return this.renderBlock(out, rates, now, outputSampleRate);
    // Split at the first sample on/after each timestamp. In particular a
    // release can prime the stretcher in the middle of a 128-frame quantum.
    const length = out[0]?.length ?? 0;
    let offset = 0;
    let ended: number | null = null;
    while (offset < length) {
      const time = now + offset / outputSampleRate;
      let next = this.scheduled[this.scheduledIndex];
      while (next && next.time <= time + 1e-10) {
        if (next.motion) this.setScratch(next.motion, true, next);
        else {
          this.stop(true, next.tail);
          this.setMode(next.mode);
          const sr = (this.track?.srRatio ?? 1) * outputSampleRate;
          if (next.loopFrames && next.loop) {
            next.loopFrames.startFrames = next.loop.start * sr;
            next.loopFrames.endFrames = next.loop.end * sr;
          }
          this.setLoop(next.loopFrames);
          if (next.playing) this.start(next.position * sr, next.startId, next.time, true, next);
        }
        next = this.scheduled[++this.scheduledIndex];
      }
      const end = next ? Math.min(length, Math.max(offset + 1, Math.ceil((next.time - now) * outputSampleRate - 1e-8))) : length;
      const id = this.renderBlock(out, rates, time, outputSampleRate, offset, end - offset);
      if (id !== null) ended = id;
      offset = end;
    }
    return ended;
  }

  private renderBlock(out: Float32Array[], rates: Float32Array, now: number, outputSampleRate: number,
    offset = 0, frames = (out[0]?.length ?? 0) - offset): number | null {
    for (const channel of out) channel.fill(0, offset, offset + frames);
    if (!this.live && this.fading.length === 0) return null;
    if (this.live && this.pendingStartTime !== null) {
      const voice = this.live;
      const loop = this.renderLoopFor(voice);
      voice.position += Math.max(0, now - this.pendingStartTime) * rates[rates.length > 1 ? offset : 0] * voice.srRatio * outputSampleRate;
      if (loop && voice.position >= loop.endFrames) {
        voice.position = loop.startFrames + (voice.position - loop.endFrames) % (loop.endFrames - loop.startFrames);
      }
      this.pendingStartTime = null;
    }
    // Once per block: retire fully-played stem ramps, so backwards reads
    // (loop folds, stretch pre-reads) see settled gains.
    if (!this.platter && this.live && this.live.source instanceof StemTrackSource) {
      this.live.source.settleCompletedRamps(this.live.position);
    }

    // Stretch voices render block-wise through the engine (it takes one
    // rate per block — tempo moves at 128-frame granularity are inaudible);
    // the per-frame loop below applies the envelope and the bookkeeping.
    let liveBlock: Float32Array[] | null = null;
    const liveAtStart = this.live;
    if (!this.platter && liveAtStart && liveAtStart.mode === 'stretch') {
      const engine = this.stretchEngine;
      if (engine?.ready && liveAtStart.srRatio === 1) {
        if (this.primedVoice !== liveAtStart) {
          engine.prime(
            liveAtStart.source,
            liveAtStart.position,
            rates[rates.length > 1 ? offset : 0],
            this.renderLoopFor(liveAtStart)
          );
          this.primedVoice = liveAtStart;
        }
        liveBlock = this.scratchFor(out.length, frames);
        engine.render(
          liveBlock,
          frames,
          liveAtStart.source,
          liveAtStart.position,
          rates[rates.length > 1 ? offset : 0],
          this.renderLoopFor(liveAtStart)
        );
      }
      // Engine absent/not ready, or track at a foreign sample rate: the
      // voice falls through to the resample path below (graceful, audible
      // pitch coupling until the stretcher is available).
    }

    let endedStartId: number | null = null;
    for (let i = 0; i < frames; i++) {
      const frame = offset + i;
      const rate = rates.length > 1 ? rates[frame] : rates[0];
      // Tails first: a voice retired by a mid-block loop wrap below must
      // not also render as a tail in its retirement frame (double-mix).
      for (let f = this.fading.length - 1; f >= 0; f--) {
        const voice = this.fading[f];
        const gain = this.gainOf(voice);
        this.mix(voice, out, frame, gain);
        if (!voice.fade?.samples) voice.position += rate * voice.srRatio;
        voice.age++;
        if (voice.fade) voice.fade.age++;
        const faded = voice.fade !== null && voice.fade.age >= this.declickFrames;
        if (faded || gain <= 0 || (!voice.fade?.samples
            && (voice.position < 0 || voice.position >= DeckSourceKernel.lengthOf(voice)))) {
          for (let j = f; j < this.fading.length - 1; j++) this.fading[j] = this.fading[j + 1];
          this.fading.pop();
        }
      }
      if (this.live) {
        const voice = this.live;
        if (this.platter) {
          const motion = this.platter;
          const time = now + i / outputSampleRate;
          const position = scratchPosition(motion, time);
          const nextPosition = scratchPosition(motion, time + 1 / outputSampleRate);
          const trackSampleRate = voice.srRatio * outputSampleRate;
          const smoothFrames = Math.max(1, Math.min(this.declickFrames, outputSampleRate * 0.001));
          const target = position !== nextPosition ? scratchGain(scratchRate(motion, time)) : 0;
          this.platterGain += Math.max(-1 / smoothFrames, Math.min(1 / smoothFrames, target - this.platterGain));
          if (voice.source instanceof StemTrackSource) voice.source.setOutputClock(this.outputFrame);
          voice.position = position * trackSampleRate;
          // Loop wraps and late command handoffs splice the PCM, not the
          // trajectory: the clock remains authoritative through the fade.
          const discontinuity = this.platterExpectedPosition !== null
            && Math.abs(voice.position - this.platterExpectedPosition) > 0.0001;
          if (discontinuity) this.platterSpliceFrames = this.declickFrames;
          const index = Math.floor(voice.position);
          const fraction = voice.position - index;
          for (let c = 0; c < out.length; c++) {
            const s0 = voice.source.sampleAt(c, index);
            const sample = s0 + fraction * (voice.source.sampleAt(c, index + 1) - s0);
            if (discontinuity) this.platterCorrection[c] = (this.platterLastSamples[c] ?? sample) - sample;
            const spliced = sample + (this.platterCorrection[c] ?? 0) * this.platterSpliceFrames / this.declickFrames;
            out[c][frame] += spliced * this.platterGain;
            this.platterLastSamples[c] = spliced;
          }
          this.platterSpliceFrames = Math.max(0, this.platterSpliceFrames - 1);
          const step = motion.loop
            ? scratchTravel(motion, time + 1 / outputSampleRate - motion.time) - scratchTravel(motion, time - motion.time)
            : nextPosition - position;
          const wraps = Math.abs(nextPosition - position - step) > 0.0000001;
          this.platterExpectedPosition = (wraps ? position + step : nextPosition) * trackSampleRate;
          voice.position = nextPosition * trackSampleRate;
          voice.age++;
          this.outputFrame++;
          continue;
        }
        const gain = this.gainOf(voice);
        if (liveBlock && voice === liveAtStart) {
          if (gain > 0) {
            for (let c = 0; c < out.length; c++) out[c][frame] += liveBlock[c][i] * gain;
          }
        } else {
          this.mix(voice, out, frame, gain);
        }
        const before = voice.position;
        voice.position += rate * voice.srRatio;
        voice.age++;
        const length = DeckSourceKernel.lengthOf(voice);
        const loop = this.loop;
        const effEnd = loop ? Math.min(loop.endFrames, length) : 0;
        if (
          loop &&
          before >= loop.startFrames &&
          before < effEnd &&
          voice.position >= effEnd
        ) {
          // Loop wrap: precedence over end-of-track inside the region.
          const wrapped =
            loop.startFrames + ((voice.position - effEnd) % (effEnd - loop.startFrames));
          if (liveBlock && voice === liveAtStart) {
            // Stretcher-rendered voice: the wrap already happened at the
            // READ layer (the render window folds past the region end), so
            // the audio is continuous — only the position bookkeeping
            // folds. No splice, no re-prime: splicing here would swap the
            // voice onto the resample path mid-block and pop every cycle.
            voice.position = wrapped;
          } else {
            // Resample path: a declick splice — retire the edge voice,
            // fade a fresh one in at the wrapped position. Full-declick
            // attack (NOT the stab attack): the wrapped content is
            // correlated with the tail, and only the symmetric equal-gain
            // crossfade sums to unity across the wrap.
            const { source, srRatio, startId, mode } = voice;
            this.retireLive();
            this.live = {
              source,
              srRatio,
              position: wrapped,
              age: 0,
              attackFrames: this.declickFrames,
              fade: null,
              startId,
              mode,
            };
          }
        } else if (voice.position >= length) {
          endedStartId = voice.startId;
          this.live = null;
        }
      }
      this.outputFrame++;
    }
    return endedStartId;
  }

  /** The loop region the stretcher should fold its read window into for
   * this voice: end clamped to the track, and only while the voice is
   * before the end edge (a voice beyond the region never wraps). */
  private renderLoopFor(voice: Voice): LoopFrames | null {
    const loop = this.loop;
    if (!loop) return null;
    const effEnd = Math.min(loop.endFrames, DeckSourceKernel.lengthOf(voice));
    if (effEnd <= loop.startFrames || voice.position >= effEnd) return null;
    return { startFrames: loop.startFrames, endFrames: effEnd };
  }

  private retireLive(tail?: NonNullable<Voice['fade']>): void {
    if (!this.live) return;
    const g0 = this.gainOf(this.live);
    this.live.fade = tail ?? { g0, age: 0 };
    this.live.fade.g0 = g0;
    this.live.fade.samples = undefined;
    // Tails always render via the resample path: the single stretcher
    // instance is freed for the next voice, and ≤5ms of varispeed in a
    // fade-out is masked by the incoming voice.
    this.live.mode = 'resample';
    this.fading.push(this.live);
    this.live = null;
    while (this.fading.length > MAX_FADING_VOICES) this.fading.shift();
  }

  /** Reusable stretch-output scratch (per channel-count/frame-length). */
  private scratchFor(channelCount: number, frames: number): Float32Array[] {
    if (this.scratch.length < channelCount || (this.scratch[0]?.length ?? 0) < frames) {
      this.scratch = [];
      for (let c = 0; c < channelCount; c++) this.scratch.push(new Float32Array(frames));
    }
    return this.scratch;
  }

  /** Envelope: fade-in age/attack capped at 1 (per-voice attack length,
   * stab-declick 01; 0 = instant unity); fade-out slopes g0 → 0 over the
   * full declick. */
  private gainOf(voice: Voice): number {
    if (voice.fade) {
      return Math.max(0, voice.fade.g0 * (1 - voice.fade.age / this.declickFrames));
    }
    if (voice.attackFrames <= 0) return 1;
    return Math.min(1, voice.age / voice.attackFrames);
  }

  /** Linear-interpolate the voice at its position into out[·][frame].
   * Reads go through the TrackSource seam (stems mix here, ramp-aware). */
  private mix(voice: Voice, out: Float32Array[], frame: number, gain: number): void {
    if (gain <= 0) return;
    if (voice.fade?.samples) {
      for (let c = 0; c < out.length; c++) out[c][frame] += (voice.fade.samples[c] ?? 0) * gain;
      return;
    }
    const idx = Math.floor(voice.position);
    const frac = voice.position - idx;
    for (let c = 0; c < out.length; c++) {
      const s0 = voice.source.sampleAt(c, idx);
      const s1 = frac > 0 ? voice.source.sampleAt(c, idx + 1) : 0;
      out[c][frame] += (s0 + frac * (s1 - s0)) * gain;
    }
  }
}
