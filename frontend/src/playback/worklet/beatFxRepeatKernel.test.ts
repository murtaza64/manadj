import { describe, expect, it } from 'vitest';
import { RepeatKernel, transGate } from './beatFxRepeatKernel';

const SR = 1000; // 1 kHz keeps frame arithmetic readable
const BEAT = 500; // 120 BPM: 500 frames per beat
const BLOCK = 128;

/** Run `frames` of `signal(frame)` through the kernel from `start`. */
function run(kernel: RepeatKernel, start: number, frames: number, signal: (f: number) => number) {
  const out: number[] = [];
  for (let f = start; f < start + frames; f += BLOCK) {
    const n = Math.min(BLOCK, start + frames - f);
    const inL = Float32Array.from({ length: n }, (_, i) => signal(f + i));
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    kernel.process(inL, inL, outL, outR, f);
    out.push(...outL);
  }
  return out;
}

function kernel() {
  const k = new RepeatKernel(SR);
  k.setSettings({ transDuty: 0.5, transSlopeMs: 4, rollFadeMs: 4 });
  k.setClock({ frame: 0, beat: 0, beatFrames: BEAT });
  return k;
}

/** Largest sample-to-sample jump, a glitch proxy for smooth inputs. */
function maxStep(samples: number[]): number {
  let max = 0;
  for (let i = 1; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i] - samples[i - 1]));
  return max;
}

describe('TRANS gate', () => {
  it('opens for the duty share with linear edges', () => {
    expect(transGate(0, 100, 0.5, 4)).toBe(0);
    expect(transGate(2, 100, 0.5, 4)).toBe(0.5);
    expect(transGate(25, 100, 0.5, 4)).toBe(1);
    expect(transGate(52, 100, 0.5, 4)).toBe(0.5);
    expect(transGate(75, 100, 0.5, 4)).toBe(0);
  });

  it('chops on the beat grid at the selected fraction, full depth = full gate', () => {
    const k = kernel();
    run(k, 0, 1000, () => 1); // settle
    k.setState({ mode: 'trans', beats: 0.25, dry: 0, wet: 1 }, 1000);
    const out = run(k, 1000, 1000, () => 1);
    // Cell = 125 frames. Frames 1000.. are beat 2.0 (cell boundary).
    const cellStart = 1250 - 1000; // after the 5 ms engage ramp
    expect(out[cellStart + 30]).toBeCloseTo(1, 5);
    expect(out[cellStart + 100]).toBeCloseTo(0, 5);
    const open = out.slice(cellStart, cellStart + 500).filter((v) => v > 0.5).length;
    expect(open / 500).toBeCloseTo(0.5, 1);
  });

  it('partial depth is a partial duck and release has no tail', () => {
    const k = kernel();
    k.setState({ mode: 'trans', beats: 0.5, dry: 0.5, wet: 0.5 }, 0);
    const out = run(k, 0, 1000, () => 1);
    expect(Math.min(...out.slice(100))).toBeCloseTo(0.5, 5);
    k.setState({ mode: 'off', beats: 0.5, dry: 1, wet: 0 }, 1000);
    const after = run(k, 1000, 200, () => 1);
    expect(after.slice(10).every((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
  });

  it('follows a beat-clock jump (seek) but ignores jitter', () => {
    const k = kernel();
    k.setClock({ frame: 1000, beat: 2.005, beatFrames: BEAT }); // jitter: ignored
    k.setState({ mode: 'trans', beats: 1, dry: 0, wet: 1 }, 1000);
    run(k, 1000, 100, () => 1);
    k.setClock({ frame: 1100, beat: 2.7, beatFrames: BEAT }); // seek: accepted
    const out = run(k, 1100, 300, () => 1);
    // Beat 2.7 → 0.7 into the cell: closed until the next beat at frame 1250.
    expect(out[50]).toBe(0);
    expect(out[200]).toBeCloseTo(1, 5);
  });
});

describe('ROLL', () => {
  const ramp = (f: number) => (f % 10_000) / 10_000;

  it('loops the last complete grid cell at the selected length, in phase', () => {
    const k = kernel();
    run(k, 0, 3000, ramp);
    // Engage at frame 3100 (beat 6.2) with a 1-beat roll: region = beat 5..6.
    k.setState({ mode: 'roll', beats: 1, dry: 0, wet: 1 }, 3100);
    expect(k.rollRegion).toMatchObject({ start: 2500, length: 500 });
    run(k, 3000, 100, ramp);
    const out = run(k, 3100, 1500, ramp);
    // At frame 3100 + x the roll plays input frame 2600 + x (now − 1 beat).
    expect(out[200]).toBeCloseTo(ramp(2800), 4);
    // Period = 500 frames.
    expect(out[700]).toBeCloseTo(out[200], 4);
    expect(out[1200]).toBeCloseTo(out[200], 4);
  });

  it('crossfades each seam (no glitch on a ramp that jumps at the wrap)', () => {
    const k = kernel();
    run(k, 0, 3100, ramp);
    k.setState({ mode: 'roll', beats: 1, dry: 0, wet: 1 }, 3100);
    const out = run(k, 3100, 2000, ramp);
    // Raw wrap would jump 500/10000 = 0.05; the 4-frame fade spreads it.
    expect(maxStep(out.slice(50))).toBeLessThan(0.02);
  });

  it('re-slices: shorter keeps the start, longer keeps the end', () => {
    const k = kernel();
    run(k, 0, 3100, ramp);
    k.setState({ mode: 'roll', beats: 1, dry: 0, wet: 1 }, 3100);
    run(k, 3100, 400, ramp);
    k.setState({ mode: 'roll', beats: 0.5, dry: 0, wet: 1 }, 3500);
    expect(k.rollRegion).toMatchObject({ start: 2500, length: 250 });
    run(k, 3500, 100, ramp);
    k.setState({ mode: 'roll', beats: 2, dry: 0, wet: 1 }, 3600);
    expect(k.rollRegion).toMatchObject({ start: 1750, length: 1000 });
    const out = run(k, 3600, 1000, ramp);
    expect(maxStep(out)).toBeLessThan(0.03);
  });

  it('release returns to the live program with no tail', () => {
    const k = kernel();
    run(k, 0, 3100, ramp);
    k.setState({ mode: 'roll', beats: 1, dry: 0, wet: 1 }, 3100);
    run(k, 3100, 1000, ramp);
    k.setState({ mode: 'off', beats: 1, dry: 1, wet: 0 }, 4100);
    const out = run(k, 4100, 500, ramp);
    for (let i = 10; i < 500; i++) expect(out[i]).toBeCloseTo(ramp(4100 + i), 5);
    expect(k.rollRegion).toBeNull();
  });

  it('without history falls back to the forward cell: live until the first wrap', () => {
    const k = kernel();
    k.setState({ mode: 'roll', beats: 1, dry: 0, wet: 1 }, 0);
    const out = run(k, 0, 1500, ramp);
    expect(out[300]).toBeCloseTo(ramp(300), 5); // first pass is live
    expect(out[800]).toBeCloseTo(ramp(300), 4); // then repeats beat 0..1
  });
});
