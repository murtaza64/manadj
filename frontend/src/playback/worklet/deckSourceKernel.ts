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

import type { SourceMode } from './protocol';

/** The worklet-internal stretcher seam (ADR 0018): feed samples, set rate,
 * transpose fixed at none. `render` fills `frames` of output whose audible
 * start is `positionFrames`, advancing at `rate`; the engine reads its own
 * read-ahead window from `channels` (track and context sample rates equal —
 * the kernel falls back to resample otherwise). */
export interface StretchEngine {
  readonly ready: boolean;
  /** Prime for a fresh voice (start/stab/mode-switch). */
  reset(): void;
  render(
    out: Float32Array[],
    frames: number,
    channels: Float32Array[],
    positionFrames: number,
    rate: number
  ): void;
}

interface Voice {
  channels: Float32Array[];
  /** Track-frames advanced per output frame at rate 1 (trackSR / outputSR). */
  srRatio: number;
  /** Position in track frames (fractional). */
  position: number;
  /** Output frames rendered since start (drives the fade-in envelope). */
  age: number;
  /** Fade-out state; null while live. Gain falls linearly from g0 over
   * declickFrames of fade age. */
  fade: { g0: number; age: number } | null;
  startId: number;
  mode: SourceMode;
}

/** Tails are ≤ declick (5ms) long; more simultaneous ones than this means
 * starts are streaming faster than 1.6ms apart — drop the oldest. */
const MAX_FADING_VOICES = 3;

export class DeckSourceKernel {
  private track: { channels: Float32Array[]; srRatio: number } | null = null;
  private live: Voice | null = null;
  private fading: Voice[] = [];
  private readonly declickFrames: number;
  /** Active loop region in track frames (looping 03), or null. */
  private loop: { startFrames: number; endFrames: number } | null = null;

  private mode: SourceMode = 'resample';
  private stretchEngine: StretchEngine | null = null;
  /** Voice the stretcher was last reset for — one prime per voice. */
  private primedVoice: Voice | null = null;
  /** Block scratch for stretch output (gain applied per frame by the kernel). */
  private scratch: Float32Array[] = [];

  constructor(declickFrames: number) {
    this.declickFrames = Math.max(1, declickFrames);
  }

  /** Hand over a track's channel data. Future starts read the new track;
   * an in-flight declick tail keeps its captured old data. */
  setTrack(channels: Float32Array[], srRatio: number): void {
    this.track = { channels, srRatio };
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
  setLoop(region: { startFrames: number; endFrames: number } | null): void {
    this.loop = region && region.endFrames > region.startFrames ? region : null;
  }

  /** Key Lock. Mid-play, splice into the new mode at the live voice's own
   * position: the retired tail fades under the new voice's fade-in — same
   * machinery as a stab, so no click and no position jump. */
  setMode(mode: SourceMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const live = this.live;
    if (!live) return;
    const { channels, srRatio, position, startId } = live;
    this.retireLive();
    this.live = { channels, srRatio, position, age: 0, fade: null, startId, mode };
  }

  /** (Re)start at a track frame. A running voice is retired into the
   * declick fade — the splice that keeps stabs click-free. */
  start(positionFrames: number, startId: number): void {
    if (!this.track) return;
    this.retireLive();
    const length = this.track.channels[0]?.length ?? 0;
    this.live = {
      channels: this.track.channels,
      srRatio: this.track.srRatio,
      position: Math.max(0, Math.min(positionFrames, Math.max(0, length - 1))),
      age: 0,
      fade: null,
      startId,
      mode: this.mode,
    };
  }

  /** Frames in the voice's own track. */
  private static lengthOf(voice: Voice): number {
    return voice.channels[0]?.length ?? 0;
  }

  /** Declick-fade to silence. Idempotent. */
  stop(): void {
    this.retireLive();
  }

  /** Track-frame position of the live voice, or null when stopped. */
  get livePositionFrames(): number | null {
    return this.live?.position ?? null;
  }

  /**
   * Render one block. `out` is zeroed and filled; `rates` is the composed
   * rate as an a-rate AudioParam array (length 1 or one-per-frame).
   * Returns the startId of a live voice that ran off the end of its track
   * this block, or null.
   */
  render(out: Float32Array[], rates: Float32Array): number | null {
    const frames = out[0]?.length ?? 0;
    for (const channel of out) channel.fill(0);
    if (!this.live && this.fading.length === 0) return null;

    // Stretch voices render block-wise through the engine (it takes one
    // rate per block — tempo moves at 128-frame granularity are inaudible);
    // the per-frame loop below applies the envelope and the bookkeeping.
    let liveBlock: Float32Array[] | null = null;
    const liveAtStart = this.live;
    if (liveAtStart && liveAtStart.mode === 'stretch') {
      const engine = this.stretchEngine;
      if (engine?.ready && liveAtStart.srRatio === 1) {
        if (this.primedVoice !== liveAtStart) {
          engine.reset();
          this.primedVoice = liveAtStart;
        }
        liveBlock = this.scratchFor(out.length, frames);
        engine.render(
          liveBlock,
          frames,
          liveAtStart.channels,
          liveAtStart.position,
          rates[0]
        );
      }
      // Engine absent/not ready, or track at a foreign sample rate: the
      // voice falls through to the resample path below (graceful, audible
      // pitch coupling until the stretcher is available).
    }

    let endedStartId: number | null = null;
    for (let i = 0; i < frames; i++) {
      const rate = rates.length > 1 ? rates[i] : rates[0];
      // Tails first: a voice retired by a mid-block loop wrap below must
      // not also render as a tail in its retirement frame (double-mix).
      for (let f = this.fading.length - 1; f >= 0; f--) {
        const voice = this.fading[f];
        const gain = this.gainOf(voice);
        this.mix(voice, out, i, gain);
        voice.position += rate * voice.srRatio;
        voice.age++;
        if (voice.fade) voice.fade.age++;
        const faded = voice.fade !== null && voice.fade.age >= this.declickFrames;
        if (faded || gain <= 0 || voice.position >= DeckSourceKernel.lengthOf(voice)) {
          this.fading.splice(f, 1);
        }
      }
      if (this.live) {
        const voice = this.live;
        const gain = this.gainOf(voice);
        if (liveBlock && voice === liveAtStart) {
          if (gain > 0) {
            for (let c = 0; c < out.length; c++) out[c][i] += liveBlock[c][i] * gain;
          }
        } else {
          this.mix(voice, out, i, gain);
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
          // The same declick splice as a stab — retire the edge voice,
          // fade a fresh one in at the wrapped position (both modes; a
          // stretch voice re-primes on its next block).
          const wrapped =
            loop.startFrames + ((voice.position - effEnd) % (effEnd - loop.startFrames));
          const { channels, srRatio, startId, mode } = voice;
          this.retireLive();
          this.live = {
            channels,
            srRatio,
            position: wrapped,
            age: 0,
            fade: null,
            startId,
            mode,
          };
        } else if (voice.position >= length) {
          endedStartId = voice.startId;
          this.live = null;
        }
      }
    }
    return endedStartId;
  }

  private retireLive(): void {
    if (!this.live) return;
    this.live.fade = { g0: this.gainOf(this.live), age: 0 };
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
    if (this.scratch.length !== channelCount || (this.scratch[0]?.length ?? 0) < frames) {
      this.scratch = [];
      for (let c = 0; c < channelCount; c++) this.scratch.push(new Float32Array(frames));
    }
    return this.scratch;
  }

  /** Envelope: fade-in age/declick capped at 1; fade-out slopes g0 → 0. */
  private gainOf(voice: Voice): number {
    if (voice.fade) {
      return Math.max(0, voice.fade.g0 * (1 - voice.fade.age / this.declickFrames));
    }
    return Math.min(1, voice.age / this.declickFrames);
  }

  /** Linear-interpolate the voice at its position into out[·][frame]. */
  private mix(voice: Voice, out: Float32Array[], frame: number, gain: number): void {
    if (gain <= 0) return;
    const idx = Math.floor(voice.position);
    const frac = voice.position - idx;
    for (let c = 0; c < out.length; c++) {
      const data = voice.channels[Math.min(c, voice.channels.length - 1)];
      if (!data) continue;
      const s0 = idx < data.length ? data[idx] : 0;
      const s1 = frac > 0 && idx + 1 < data.length ? data[idx + 1] : 0;
      out[c][frame] += (s0 + frac * (s1 - s0)) * gain;
    }
  }
}
