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
 */

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
}

/** Tails are ≤ declick (5ms) long; more simultaneous ones than this means
 * starts are streaming faster than 1.6ms apart — drop the oldest. */
const MAX_FADING_VOICES = 3;

export class DeckSourceKernel {
  private track: { channels: Float32Array[]; srRatio: number } | null = null;
  private live: Voice | null = null;
  private fading: Voice[] = [];
  private readonly declickFrames: number;

  constructor(declickFrames: number) {
    this.declickFrames = Math.max(1, declickFrames);
  }

  /** Hand over a track's channel data. Future starts read the new track;
   * an in-flight declick tail keeps its captured old data. */
  setTrack(channels: Float32Array[], srRatio: number): void {
    this.track = { channels, srRatio };
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

    let endedStartId: number | null = null;
    for (let i = 0; i < frames; i++) {
      const rate = rates.length > 1 ? rates[i] : rates[0];
      if (this.live) {
        const voice = this.live;
        this.mix(voice, out, i, this.gainOf(voice));
        voice.position += rate * voice.srRatio;
        voice.age++;
        if (voice.position >= DeckSourceKernel.lengthOf(voice)) {
          endedStartId = voice.startId;
          this.live = null;
        }
      }
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
    }
    return endedStartId;
  }

  private retireLive(): void {
    if (!this.live) return;
    this.live.fade = { g0: this.gainOf(this.live), age: 0 };
    this.fading.push(this.live);
    this.live = null;
    while (this.fading.length > MAX_FADING_VOICES) this.fading.shift();
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
