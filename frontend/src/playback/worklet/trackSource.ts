/**
 * TrackSource — the deck source worklet's audio-data seam (stems #209,
 * map #118 / #150). The kernel and the stretch window fill read track
 * samples through this interface instead of raw channel arrays, so a deck
 * source can be a single decoded track OR a bank of stems mixed with
 * per-stem gains at the read layer — BEFORE the stretch stage, preserving
 * the one-stretcher-per-deck invariant and giving sample-locked stems by
 * construction (one playhead, one voice model).
 *
 * Stem gains are piecewise functions of TRACK POSITION, not output time:
 * a gain change anchors a short linear ramp at the position the live voice
 * is currently sounding, so both read paths see the same smooth signal —
 * the resample path reads it directly, and the stretcher's re-filled
 * read-ahead window picks it up on the next block (the window model refills
 * every block, so the change propagates without a splice or re-prime).
 * Reads before the anchor (declick tails, loop folds) see the old gain —
 * a ≤5 ms inconsistency, inaudible by the same argument as the declick.
 *
 * Pure module (no Web Audio, no globals): worklet-safe by contract and
 * fully under vitest (ADR 0002).
 */

/** Read seam consumed by the kernel voices and the stretch window fill. */
export interface TrackSource {
  /** Track length in frames. */
  readonly length: number;
  /** Sample at an integer frame index; out-of-range reads are 0 and a
   * channel index past the data upmixes from the last channel (mono→stereo
   * parity with the old raw-array reads). */
  sampleAt(channel: number, index: number): number;
  /** Bulk fill for the stretch read-ahead window: dest receives frames
   * [windowStart, windowStart + dest.length), zero-padded outside the
   * track. The loop-fold segmentation lives above this (windowFill.ts). */
  fillWindow(dest: Float32Array, channel: number, windowStart: number): void;
}

/** A single decoded track: thin wrapper over its channel arrays. */
export class SingleTrackSource implements TrackSource {
  readonly length: number;
  private readonly channels: Float32Array[];

  constructor(channels: Float32Array[]) {
    this.channels = channels;
    this.length = channels[0]?.length ?? 0;
  }

  sampleAt(channel: number, index: number): number {
    const data = this.channels[Math.min(channel, this.channels.length - 1)];
    if (!data || index < 0 || index >= data.length) return 0;
    return data[index];
  }

  fillWindow(dest: Float32Array, channel: number, windowStart: number): void {
    const data = this.channels[Math.min(channel, this.channels.length - 1)];
    fillLinear(dest, data, windowStart);
  }
}

/** The plain three-way fill: zero-pad before 0 and past the track end.
 * (Moved here from windowFill.ts — the single-source bulk path.) */
export function fillLinear(
  dest: Float32Array,
  data: Float32Array | undefined,
  windowStart: number
): void {
  if (!data) {
    dest.fill(0);
    return;
  }
  const windowEnd = windowStart + dest.length;
  const from = Math.max(0, windowStart);
  const to = Math.min(data.length, windowEnd);
  if (from > windowStart) dest.fill(0, 0, from - windowStart);
  if (to > from) dest.set(data.subarray(from, to), from - windowStart);
  if (to - windowStart < dest.length) dest.fill(0, Math.max(0, to - windowStart));
}

/** A per-stem gain ramp anchored in track frames. */
interface GainRamp {
  g0: number;
  g1: number;
  startFrame: number;
  lengthFrames: number;
}

/**
 * A bank of stems mixed at read time with per-stem declick-ramped gains.
 * `stems[s]` is one stem's channel arrays; all stems share length and
 * channel count (enforced loosely — reads clamp). Unity gains sum the
 * stems back to ≈ the original (#149: split with --clip-mode none,
 * alignment-gated codec).
 */
export class StemTrackSource implements TrackSource {
  readonly length: number;
  private readonly stems: Float32Array[][];
  /** Settled per-stem gains: what gainAt returns wherever no ramp is in
   * flight. Ramps are TRANSIENT declick devices, not the state itself —
   * an unsettled ramp anchored at the kill position would resurrect the
   * stem for reads before it (seek-back bug, stems #210 review). */
  private readonly gains: number[];
  private readonly ramps: (GainRamp | null)[];

  constructor(stems: Float32Array[][]) {
    this.stems = stems;
    this.length = stems[0]?.[0]?.length ?? 0;
    this.gains = stems.map(() => 1);
    this.ramps = stems.map(() => null);
  }

  get stemCount(): number {
    return this.stems.length;
  }

  /** The gain of stem `s` at a track frame (ramp-aware while in flight). */
  gainAt(s: number, frame: number): number {
    const ramp = this.ramps[s];
    if (!ramp) return this.gains[s];
    if (frame <= ramp.startFrame) return ramp.g0;
    const t = Math.min(1, (frame - ramp.startFrame) / ramp.lengthFrames);
    return ramp.g0 + (ramp.g1 - ramp.g0) * t;
  }

  /** Ramp stem `s` to `target` starting at `atFrame` over `rampFrames`
   * (the declick length). Re-anchoring mid-ramp starts from the current
   * effective gain, so rapid toggles stay click-free. */
  setGain(s: number, target: number, atFrame: number, rampFrames: number): void {
    if (s < 0 || s >= this.stems.length) return;
    const g0 = this.gainAt(s, atFrame);
    this.gains[s] = target;
    this.ramps[s] =
      rampFrames > 0 && g0 !== target
        ? { g0, g1: target, startFrame: atFrame, lengthFrames: Math.max(1, rampFrames) }
        : null;
  }

  /** Collapse every in-flight ramp to its target — reads anywhere in the
   * track then see the settled gain. Called on voice (re)starts: a seek is
   * a declick splice already, so the new voice needs no gain ramp. */
  settleGains(): void {
    this.ramps.fill(null);
  }

  /** Null out ramps the live voice has fully played past (once per render
   * block): after that, backwards reads (loop folds, stretch pre-reads)
   * must see the settled gain, not the pre-kill one. */
  settleCompletedRamps(positionFrames: number): void {
    for (let s = 0; s < this.ramps.length; s++) {
      const ramp = this.ramps[s];
      if (ramp && positionFrames > ramp.startFrame + ramp.lengthFrames) this.ramps[s] = null;
    }
  }

  sampleAt(channel: number, index: number): number {
    if (index < 0 || index >= this.length) return 0;
    let sum = 0;
    for (let s = 0; s < this.stems.length; s++) {
      const stem = this.stems[s];
      const data = stem[Math.min(channel, stem.length - 1)];
      if (!data || index >= data.length) continue;
      const gain = this.gainAt(s, index);
      if (gain === 0) continue;
      sum += data[index] * gain;
    }
    return sum;
  }

  fillWindow(dest: Float32Array, channel: number, windowStart: number): void {
    dest.fill(0);
    const from = Math.max(0, windowStart);
    const to = Math.min(this.length, windowStart + dest.length);
    if (to <= from) return;
    for (let s = 0; s < this.stems.length; s++) {
      const stem = this.stems[s];
      const data = stem[Math.min(channel, stem.length - 1)];
      if (!data) continue;
      // Constant gain over the run unless the ramp intersects it.
      const ramp = this.ramps[s];
      let constGain: number | null;
      if (!ramp) constGain = 1;
      else if (from >= ramp.startFrame + ramp.lengthFrames) constGain = ramp.g1;
      else if (to <= ramp.startFrame) constGain = ramp.g0;
      else constGain = null;
      if (constGain !== null) {
        if (constGain === 0) continue;
        if (constGain === 1) {
          for (let i = from; i < to; i++) dest[i - windowStart] += data[i];
        } else {
          for (let i = from; i < to; i++) dest[i - windowStart] += data[i] * constGain;
        }
        continue;
      }
      // Ramp intersects the window: per-sample gain (≤ declick + window,
      // and only while a change is in flight).
      for (let i = from; i < to; i++) {
        const gain = this.gainAt(s, i);
        if (gain !== 0) dest[i - windowStart] += data[i] * gain;
      }
    }
  }
}
