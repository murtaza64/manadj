import { describe, expect, it } from 'vitest';
import { DeckSourceKernel } from './deckSourceKernel';

/**
 * Pure position-bookkeeping and declick tests for the worklet kernel —
 * synthetic samples in, frames out, no Web Audio (ADR 0002 / ADR 0018).
 * A tiny declick window (4 frames) keeps the envelopes readable.
 */

const DECLICK = 4;

/** data[i] = i + 1 — nonzero everywhere, so gain effects are visible. */
function ramp(n: number): Float32Array {
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = i + 1;
  return data;
}

/** Render `frames` through a stereo output; returns [out, endedStartIds]. */
function render(
  kernel: DeckSourceKernel,
  frames: number,
  rate: number | Float32Array = 1
): { out: [Float32Array, Float32Array]; ended: number[] } {
  const out: [Float32Array, Float32Array] = [
    new Float32Array(frames),
    new Float32Array(frames),
  ];
  const rates = typeof rate === 'number' ? new Float32Array([rate]) : rate;
  const ended: number[] = [];
  const id = kernel.render(out, rates);
  if (id !== null) ended.push(id);
  return { out, ended };
}

describe('DeckSourceKernel silence', () => {
  it('renders silence with no track', () => {
    const kernel = new DeckSourceKernel(DECLICK);
    const { out, ended } = render(kernel, 8);
    expect(Array.from(out[0])).toEqual(new Array(8).fill(0));
    expect(ended).toEqual([]);
  });

  it('renders silence with a track that has not started', () => {
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([ramp(16)], 1);
    const { out } = render(kernel, 8);
    expect(Array.from(out[0])).toEqual(new Array(8).fill(0));
  });
});

describe('DeckSourceKernel resample voice', () => {
  it('fades in over declickFrames, then is bit-exact at rate 1', () => {
    const data = ramp(32);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, 16);
    // Envelope: gain = age/declick, capped at 1 (frame 0 silent, like
    // today's setValueAtTime(0) + linearRamp).
    for (let i = 0; i < DECLICK; i++) {
      expect(out[0][i]).toBeCloseTo(data[i] * (i / DECLICK), 6);
    }
    // Bit-exact after the fade: Float32 equality, not closeTo.
    for (let i = DECLICK; i < 16; i++) {
      expect(out[0][i]).toBe(data[i]);
    }
  });

  it('upmixes a mono track to both output channels', () => {
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([ramp(32)], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, 8);
    expect(Array.from(out[1])).toEqual(Array.from(out[0]));
  });

  it('maps stereo channels independently', () => {
    const left = ramp(32);
    const right = ramp(32).map((v) => -v);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([left, right as Float32Array], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, 8);
    for (let i = DECLICK; i < 8; i++) {
      expect(out[0][i]).toBe(left[i]);
      expect(out[1][i]).toBe(right[i]);
    }
  });

  it('starts from a given frame', () => {
    const data = ramp(32);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.start(10, 1);
    const { out } = render(kernel, 8);
    for (let i = DECLICK; i < 8; i++) expect(out[0][i]).toBe(data[10 + i]);
  });

  it('clamps the start position into the track', () => {
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([ramp(8)], 1);
    kernel.start(1000, 1);
    expect(kernel.livePositionFrames).toBe(7);
  });

  it('interpolates linearly at fractional rates', () => {
    const data = ramp(32);
    const kernel = new DeckSourceKernel(1); // gain 1 from frame 1
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, 8, 0.5);
    // position(k) = 0.5k; lerp on a ramp is the ramp itself: data[0.5k].
    for (let k = 1; k < 8; k++) {
      expect(out[0][k]).toBeCloseTo(1 + 0.5 * k, 6);
    }
    expect(kernel.livePositionFrames).toBeCloseTo(4, 6);
  });

  it('honors per-sample (a-rate) rate arrays', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(64)], 1);
    kernel.start(0, 1);
    const rates = new Float32Array([1, 2, 1, 2, 1, 2, 1, 2]);
    render(kernel, 8, rates);
    // Position advances by the sum of the per-sample increments.
    expect(kernel.livePositionFrames).toBeCloseTo(12, 6);
  });

  it('scales the increment by the sample-rate ratio', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(64)], 2); // track at 2x the output rate
    kernel.start(0, 1);
    render(kernel, 8, 1);
    expect(kernel.livePositionFrames).toBeCloseTo(16, 6);
  });
});

describe('DeckSourceKernel stop and splice', () => {
  it('stop declick-fades to silence and never reports ended', () => {
    const data = ramp(64);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    render(kernel, 8); // past the fade-in, gain = 1
    kernel.stop();
    const { out, ended } = render(kernel, 8);
    // Fade slope: 1 → 0 over declickFrames, still advancing.
    for (let i = 0; i < DECLICK; i++) {
      expect(out[0][i]).toBeCloseTo(data[8 + i] * (1 - i / DECLICK), 6);
    }
    for (let i = DECLICK; i < 8; i++) expect(out[0][i]).toBe(0);
    expect(ended).toEqual([]);
    expect(kernel.livePositionFrames).toBeNull();
  });

  it('stop is idempotent', () => {
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([ramp(16)], 1);
    kernel.stop();
    kernel.stop();
    const { out } = render(kernel, 4);
    expect(Array.from(out[0])).toEqual([0, 0, 0, 0]);
  });

  it('restart-while-running splices: old voice fades out under the new fade-in', () => {
    const data = ramp(128);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    render(kernel, 8); // old voice at full gain, position 8
    kernel.start(100, 2); // cue stab
    const { out } = render(kernel, 8);
    for (let i = 0; i < DECLICK; i++) {
      const oldPart = data[8 + i] * (1 - i / DECLICK);
      const newPart = data[100 + i] * (i / DECLICK);
      expect(out[0][i]).toBeCloseTo(oldPart + newPart, 5);
    }
    // After the splice only the new voice remains, at full gain.
    for (let i = DECLICK; i < 8; i++) expect(out[0][i]).toBe(data[100 + i]);
  });

  it('rapid restarts keep each tail (finger-drumming, streamed jog seeks)', () => {
    const data = ramp(128);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    render(kernel, 8); // voice A at full gain, position 8
    kernel.start(40, 2); // stab B while A's tail would still be fading...
    kernel.start(80, 3); // ...and stab C one frame-block later? No: same block.
    const { out } = render(kernel, 8);
    // A retired at gain 1; B retired at gain 0 (never rendered) and is
    // inaudible; C fades in. Both audible voices must sound: no hard cut.
    for (let i = 0; i < DECLICK; i++) {
      const tailA = data[8 + i] * (1 - i / DECLICK);
      const liveC = data[80 + i] * (i / DECLICK);
      expect(out[0][i]).toBeCloseTo(tailA + liveC, 5);
    }
    for (let i = DECLICK; i < 8; i++) expect(out[0][i]).toBe(data[80 + i]);
  });

  it('a voice retired mid-fade-in fades out from its current gain', () => {
    const data = ramp(64);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    render(kernel, 2); // gain now 2/4
    kernel.stop();
    const { out } = render(kernel, DECLICK);
    // Slope from g0 = 0.5 down over declickFrames.
    for (let i = 0; i < DECLICK; i++) {
      expect(out[0][i]).toBeCloseTo(data[2 + i] * 0.5 * (1 - i / DECLICK), 6);
    }
  });
});

describe('DeckSourceKernel end of track', () => {
  it('reports ended once with the startId, then renders silence', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(8)], 1);
    kernel.start(4, 7);
    const first = render(kernel, 8);
    expect(first.ended).toEqual([7]);
    // Frames past the end are silent (frame 0 is the fade-in zero).
    for (let i = 4; i < 8; i++) expect(first.out[0][i]).toBe(0);
    const second = render(kernel, 8);
    expect(second.ended).toEqual([]);
    expect(Array.from(second.out[0])).toEqual(new Array(8).fill(0));
  });

  it('does not report ended for a stopped (fading) voice', () => {
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([ramp(8)], 1);
    kernel.start(6, 9);
    kernel.stop();
    const { ended } = render(kernel, 16);
    expect(ended).toEqual([]);
  });
});

describe('DeckSourceKernel track swap', () => {
  it('a fading voice keeps sounding the old track after setTrack', () => {
    const oldData = ramp(64);
    const newData = new Float32Array(64); // silence
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([oldData], 1);
    kernel.start(0, 1);
    render(kernel, 8);
    kernel.stop();
    kernel.setTrack([newData], 1);
    const { out } = render(kernel, DECLICK);
    // The declick tail still reads the OLD track's samples.
    for (let i = 0; i < DECLICK; i++) {
      expect(out[0][i]).toBeCloseTo(oldData[8 + i] * (1 - i / DECLICK), 6);
    }
  });

  it('start after setTrack plays the new track', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(16)], 1);
    kernel.start(0, 1);
    const newData = ramp(16).map((v) => v * 10) as Float32Array;
    kernel.stop();
    kernel.setTrack([newData], 1);
    kernel.start(0, 2);
    const { out } = render(kernel, 8);
    for (let i = 1; i < 8; i++) expect(out[0][i]).toBe(newData[i]);
  });
});
