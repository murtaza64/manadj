import { describe, expect, it } from 'vitest';
import { DeckSourceKernel } from './deckSourceKernel';
import type { StretchEngine } from './deckSourceKernel';

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

/**
 * Deterministic fake stretcher (ADR 0002: fake at the true seam): output is
 * the NEGATED track sample at the audible position — distinguishable from
 * the resample path (positive) while keeping position math checkable.
 */
class FakeStretchEngine implements StretchEngine {
  ready = true;
  resets = 0;
  calls: Array<{ position: number; rate: number; frames: number }> = [];

  reset(): void {
    this.resets++;
  }

  render(
    out: Float32Array[],
    frames: number,
    channels: Float32Array[],
    positionFrames: number,
    rate: number
  ): void {
    this.calls.push({ position: positionFrames, rate, frames });
    for (let c = 0; c < out.length; c++) {
      const data = channels[Math.min(c, channels.length - 1)];
      for (let i = 0; i < frames; i++) {
        const idx = Math.round(positionFrames + i * rate);
        out[c][i] = idx < data.length ? -data[idx] : 0;
      }
    }
  }
}

describe('DeckSourceKernel stretch mode (Key Lock)', () => {
  function stretchKernel(data: Float32Array, engine: StretchEngine) {
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.setStretchEngine(engine);
    kernel.setMode('stretch');
    return kernel;
  }

  it('renders through the stretch engine with the fade-in envelope', () => {
    const data = ramp(64);
    const fake = new FakeStretchEngine();
    const kernel = stretchKernel(data, fake);
    kernel.start(10, 1);
    const { out } = render(kernel, 8);
    for (let i = 0; i < 8; i++) {
      expect(out[0][i]).toBeCloseTo(-data[10 + i] * Math.min(i / DECLICK, 1), 5);
    }
  });

  it('advances position by rate and hands the engine the audible position', () => {
    const fake = new FakeStretchEngine();
    const kernel = stretchKernel(ramp(64), fake);
    kernel.start(10, 1);
    render(kernel, 8, 0.5);
    expect(kernel.livePositionFrames).toBeCloseTo(14, 6);
    render(kernel, 8, 0.5);
    expect(fake.calls.map((c) => c.position)).toEqual([10, 14]);
    expect(fake.calls[0].rate).toBe(0.5);
  });

  it('mode switch mid-play splices at the audible position (no jump)', () => {
    const data = ramp(64);
    const fake = new FakeStretchEngine();
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.setStretchEngine(fake);
    kernel.start(0, 1); // resample (default mode)
    render(kernel, 8); // full gain, position 8
    kernel.setMode('stretch');
    const { out } = render(kernel, 8);
    // Old resample tail fades out; stretch voice fades in at the SAME
    // position: data[8+i]·(1−i/D) − data[8+i]·(i/D).
    for (let i = 0; i < DECLICK; i++) {
      expect(out[0][i]).toBeCloseTo(data[8 + i] * (1 - (2 * i) / DECLICK), 5);
    }
    for (let i = DECLICK; i < 8; i++) expect(out[0][i]).toBeCloseTo(-data[8 + i], 5);
    expect(kernel.livePositionFrames).toBeCloseTo(16, 6);
  });

  it('switching back to resample splices seamlessly (tail is resample)', () => {
    const data = ramp(64);
    const fake = new FakeStretchEngine();
    const kernel = stretchKernel(data, fake);
    kernel.start(0, 1);
    render(kernel, 8); // stretch at full gain, position 8
    kernel.setMode('resample');
    const { out } = render(kernel, 8);
    // The retired stretch voice's declick tail renders via the RESAMPLE
    // path (one stretcher instance, Mixxx-style): tail + fade-in of the new
    // resample voice sum exactly to the plain samples.
    for (let i = 0; i < 8; i++) {
      expect(out[0][i]).toBeCloseTo(data[8 + i], 5);
    }
  });

  it('same-mode setMode is a no-op (no splice, no reset)', () => {
    const fake = new FakeStretchEngine();
    const kernel = stretchKernel(ramp(64), fake);
    kernel.start(0, 1);
    render(kernel, 8);
    const resets = fake.resets;
    kernel.setMode('stretch');
    render(kernel, 8);
    expect(fake.resets).toBe(resets);
  });

  it('resets the engine once per stretch voice', () => {
    const fake = new FakeStretchEngine();
    const kernel = stretchKernel(ramp(256), fake);
    kernel.start(0, 1);
    render(kernel, 8);
    render(kernel, 8);
    expect(fake.resets).toBe(1);
    kernel.start(100, 2); // stab: new voice, new prime
    render(kernel, 8);
    expect(fake.resets).toBe(2);
  });

  it('falls back to resample without an engine, and while not ready', () => {
    const data = ramp(64);
    const noEngine = new DeckSourceKernel(DECLICK);
    noEngine.setTrack([data], 1);
    noEngine.setMode('stretch');
    noEngine.start(0, 1);
    const a = render(noEngine, 8);
    for (let i = DECLICK; i < 8; i++) expect(a.out[0][i]).toBe(data[i]);

    const fake = new FakeStretchEngine();
    fake.ready = false;
    const notReady = stretchKernel(data, fake);
    notReady.start(0, 1);
    const b = render(notReady, 8);
    for (let i = DECLICK; i < 8; i++) expect(b.out[0][i]).toBe(data[i]);
    expect(fake.calls).toEqual([]);
  });

  it('falls back to resample when track and context rates differ', () => {
    const data = ramp(64);
    const fake = new FakeStretchEngine();
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 2); // srRatio ≠ 1
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    kernel.start(0, 1);
    render(kernel, 8);
    expect(fake.calls).toEqual([]);
  });

  it('setMode while stopped applies to the next start', () => {
    const data = ramp(64);
    const fake = new FakeStretchEngine();
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([data], 1);
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    kernel.start(0, 1);
    const { out } = render(kernel, 8);
    for (let i = 1; i < 8; i++) expect(out[0][i]).toBeCloseTo(-data[i], 5);
  });

  it('reports ended when a stretch voice runs off the track', () => {
    const fake = new FakeStretchEngine();
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(8)], 1);
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    kernel.start(6, 9);
    const { ended } = render(kernel, 8);
    expect(ended).toEqual([9]);
    const after = render(kernel, 8);
    expect(Array.from(after.out[0])).toEqual(new Array(8).fill(0));
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
