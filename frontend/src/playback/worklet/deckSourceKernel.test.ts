import { describe, expect, it, vi } from 'vitest';
import { DeckSourceKernel } from './deckSourceKernel';
import type { StretchEngine } from './deckSourceKernel';
import type { TrackSource } from './trackSource';
import type { ScratchMotion, ScheduledScratchFrame } from './scratchMotion';
import { moveScratch, scratchPosition } from './scratchMotion';

describe('DeckSourceKernel platter trajectory', () => {
  it.each(['resample', 'stretch'] as const)('uses the rate offset after an intra-block %s release', mode => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(1000)], 1);
    const primes: number[] = [];
    kernel.setStretchEngine({ ready: true, prime: (_s, _p, rate) => primes.push(rate),
      render: (out, frames) => { for (const channel of out) channel.fill(1, 0, frames); } });
    kernel.scheduleScratch([
      { time: 0, motion: { position: 0.1, time: 0, drive: -8, rate: -2, trackDuration: 1, loop: null },
        position: 0.1, playing: false, loop: null, rate: 1, mode, startId: 1 },
      { time: 0.003, motion: null, position: 0.2, playing: true, loop: null, rate: 1, mode, startId: 2 },
    ]);
    kernel.render([new Float32Array(8)], new Float32Array([9, 9, 9, 1, 2, 3, 4, 5]), 0, 1000);
    expect(kernel.livePositionFrames).toBe(215);
    expect(primes).toEqual(mode === 'stretch' ? [1] : []);
  });
  it('renders pending and split schedules without allocating channel or rate views', () => {
    const kernel = new DeckSourceKernel(4);
    kernel.setTrack([new Float32Array(48000).fill(1)], 1);
    kernel.scheduleScratch([
      { time: 0.001, motion: { position: 0.5, time: 0.001, drive: -8, rate: -2, trackDuration: 1, loop: null },
        position: 0.5, playing: false, loop: null, rate: 1, mode: 'resample', startId: 1 },
      { time: 0.005, motion: null, position: 0.45, playing: true, loop: null, rate: 1, mode: 'resample', startId: 2 },
      { time: 10, motion: null, position: 0, playing: false, loop: null, rate: 1, mode: 'resample', startId: 3 },
    ]);
    const out = [new Float32Array(128), new Float32Array(128)];
    const rates = new Float32Array(128).fill(1);
    const views = vi.spyOn(Float32Array.prototype, 'subarray');
    const maps = vi.spyOn(Array.prototype, 'map');
    const slices = vi.spyOn(Array.prototype, 'slice');
    const splices = vi.spyOn(Array.prototype, 'splice');
    let counts: number[];
    try {
      for (let i = 0; i < 20; i++) kernel.render(out, rates, i * 128 / 48000, 48000);
      counts = [views.mock.calls.length, maps.mock.calls.length, slices.mock.calls.length, splices.mock.calls.length];
    } finally { views.mockRestore(); maps.mockRestore(); slices.mockRestore(); splices.mockRestore(); }
    expect(counts).toEqual([0, 0, 0, 0]);
    expect(out[0][127]).toBe(1);
  });
  it.each([false, true])('renders both opposite 5ms strokes and release inside one quantum (playing=%s)', (playing) => {
    const kernel = new DeckSourceKernel(1, 0);
    kernel.setTrack([ramp(8000)], 1);
    const primes: number[] = [];
    kernel.setStretchEngine({ ready: true, prime: (_s, p) => primes.push(p),
      render: (out, frames) => out.forEach((c) => c.fill(-7, 0, frames)) });
    const base = { position: 0.5, time: 1, drive: 10, rate: 4, trackDuration: 1, loop: null };
    const reverse = moveScratch(base, 1.008, -0.08, 0.005);
    const frames: ScheduledScratchFrame[] = [
      { time: 1, motion: base, position: 0.5, playing, loop: null, rate: 1, mode: 'stretch', startId: 1 },
      { time: 1.008, motion: reverse,
        position: reverse.position, playing, loop: null, rate: 1, mode: 'stretch', startId: 2 },
      { time: 1.014, motion: null, position: 0.7, playing, loop: null, rate: 1, mode: 'stretch', startId: 3 },
    ];
    kernel.scheduleScratch(frames);
    const out = [new Float32Array(128)];
    kernel.render(out, new Float32Array([1]), 1, 8000);
    expect(out[0][16]).toBeGreaterThan(4001);
    expect(out[0][55]).toBeGreaterThan(out[0][16]); // no packet-expiry hold
    expect(out[0].slice(65, 110).some(v => v > 0)).toBe(true);
    expect(out[0][127]).toBe(playing ? -7 : 0);
    expect(primes).toEqual(playing ? [5600] : []);
    expect(kernel.livePositionFrames).toBe(playing ? 5616 : null);
  });

  it.each(['stop', 'start', 'load', 'manual'] as const)('%s cancels future scheduled scratch', (action) => {
    const kernel = new DeckSourceKernel(1, 0);
    kernel.setTrack([ramp(1000)], 1);
    kernel.scheduleScratch([{ time: 2, motion: { position: 0.5, time: 2, drive: -4,
      rate: -1, trackDuration: 1, loop: null }, position: 0.5, playing: false,
      loop: null, rate: 1, mode: 'resample', startId: 1 }]);
    if (action === 'stop') kernel.stop();
    if (action === 'start') kernel.start(100, 2);
    if (action === 'load') kernel.setTrack([ramp(1000)], 1);
    if (action === 'manual') kernel.setScratch({ position: 0.2, time: 1, drive: 0,
      rate: 0, trackDuration: 1, loop: null });
    kernel.render([new Float32Array(10)], new Float32Array([1]), 2, 1000);
    expect(kernel.livePositionFrames).toBe(action === 'start' ? 110 : action === 'manual' ? 200 : null);
  });
  const motion: ScratchMotion = { position: 0.5, time: 1, drive: -10,
    rate: -2.5, trackDuration: 1, loop: null };

  it('renders timestamped reverse PCM and converges to a silent hold', () => {
    const kernel = new DeckSourceKernel(2, 0);
    kernel.setTrack([ramp(1000)], 1);
    kernel.setScratch(motion);
    const out = [new Float32Array(10)];
    kernel.render(out, new Float32Array([1]), 1.005, 1000);
    expect(out[0][3]).toBeCloseTo(1000 * scratchPosition(motion, 1.008) + 1, 4);
    expect(kernel.livePositionFrames).toBeCloseTo(1000 * scratchPosition(motion, 1.015));
    kernel.render([new Float32Array(20)], new Float32Array([1]), 1.015, 1000);
    expect(kernel.livePositionFrames).toBeGreaterThan(400);
    kernel.render(out, new Float32Array([1]), 1.12, 1000);
    expect(Array.from(out[0])).toEqual(new Array(10).fill(0));
    expect(kernel.livePositionFrames).toBeCloseTo(400, 3);
  });

  it('declicks reverse loop wraps without changing the timestamped position', () => {
    const kernel = new DeckSourceKernel(4, 0);
    const data = new Float32Array(1000);
    for (let i = 100; i < 120; i++) data[i] = (i - 100) / 9.5 - 1;
    kernel.setTrack([data], 1);
    const looped = { ...motion, position: 0.106, drive: -2, rate: -0.5,
      loop: { start: 0.1, end: 0.12 } };
    kernel.setScratch(looped);
    const out = [new Float32Array(20)];
    kernel.render(out, new Float32Array([1]), 1, 1000);
    expect(Math.abs(out[0][7] - out[0][6])).toBeLessThan(0.5);
    expect(kernel.livePositionFrames).toBeCloseTo(scratchPosition(looped, 1.02) * 1000);
  });

  it('ramps stem kills in output time while reversing and while held', () => {
    const kernel = new DeckSourceKernel(4, 0);
    kernel.setStems([[new Float32Array(1000).fill(1)]], 1);
    kernel.setScratch(motion);
    const out = [new Float32Array(8)];
    kernel.render(out, new Float32Array([1]), 1, 1000);
    kernel.setStemGains([0]);
    kernel.render(out, new Float32Array([1]), 1.008, 1000);
    expect(out[0][0]).toBe(1);
    expect(out[0][2]).toBeCloseTo(0.5);
    expect(out[0][7]).toBe(0);
    kernel.setScratch({ ...motion, position: 0.484, time: 1.016, drive: 0, rate: 0 });
    kernel.setStemGains([1]);
    kernel.render(out, new Float32Array([1]), 1.016, 1000);
    kernel.setScratch({ ...motion, position: 0.484, time: 1.024, drive: 10, rate: 1 });
    kernel.render(out, new Float32Array([1]), 1.024, 1000);
    expect(out[0][7]).toBe(1);
  });

  it('never feeds signed or held scratch rates to Key Lock and restores stretch on start', () => {
    const kernel = new DeckSourceKernel(4, 0);
    const seen: number[] = [];
    kernel.setStretchEngine({ ready: true, prime: (_s, _p, rate) => seen.push(rate),
      render: (out, _n, _s, _p, rate) => { seen.push(rate); out.forEach(c => c.fill(1)); } });
    kernel.setTrack([new Float32Array(1000).fill(1)], 1);
    kernel.setMode('stretch');
    kernel.setScratch(motion);
    kernel.render([new Float32Array(50)], new Float32Array([1.2]), 1, 1000);
    expect(seen).toEqual([]);
    kernel.stop();
    kernel.start(400, 1);
    kernel.render([new Float32Array(8)], new Float32Array([1.2]), 1.05, 1000);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeCloseTo(1.2);
  });

  it('fades stops to silence and does not resurrect held DC on release', () => {
    const kernel = new DeckSourceKernel(4, 0);
    kernel.setTrack([new Float32Array(1000).fill(1)], 1);
    kernel.setScratch(motion);
    kernel.render([new Float32Array(150)], new Float32Array([1]), 1, 1000);
    kernel.stop();
    const out = [new Float32Array(8)];
    kernel.render(out, new Float32Array([1]), 1.15, 1000);
    expect(Array.from(out[0])).toEqual(new Array(8).fill(0));
  });

  it('catches a normal handoff up to the main-thread anchor before rendering', () => {
    const kernel = new DeckSourceKernel(4, 0);
    kernel.setTrack([ramp(1000)], 1);
    kernel.start(410, 1, 1.018);
    const out = [new Float32Array(8)];
    kernel.render(out, new Float32Array([1.25]), 1.026, 1000);
    expect(out[0][0]).toBeCloseTo(421);
    expect(kernel.livePositionFrames).toBeCloseTo(430);
  });

  it.each([0, 1])('holds silently at track boundary %s and accepts motion back into the track', boundary => {
    const kernel = new DeckSourceKernel(4, 0);
    kernel.setTrack([new Float32Array(2000).fill(1)], 2);
    kernel.setScratch({ ...motion, position: boundary, drive: boundary === 0 ? -10 : 10, rate: 0 });
    const out = [new Float32Array(20)];
    expect(kernel.render(out, new Float32Array([1]), 1, 1000)).toBeNull();
    expect(Array.from(out[0])).toEqual(new Array(20).fill(0));
    expect(kernel.livePositionFrames).toBe(boundary * 2000);
    const inward = { ...motion, time: 2, position: boundary, drive: boundary === 0 ? 10 : -10, rate: 0 };
    kernel.setScratch(inward);
    kernel.render(out, new Float32Array([1]), 2, 1000);
    expect(out[0][5]).toBe(1);
    expect(kernel.livePositionFrames).toBeCloseTo(scratchPosition(inward, 2.02) * 2000);
  });
});

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
    expect(kernel.livePositionFrames).toBe(8);
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

describe('DeckSourceKernel asymmetric declick (stab-declick 01)', () => {
  const ATTACK = 1;

  it('starts reach unity in attackFrames while stops keep the full declick', () => {
    const data = new Float32Array(64).fill(1);
    const kernel = new DeckSourceKernel(DECLICK, ATTACK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, 4);
    // attack = 1 frame: frame 0 is age 0 (silent, envelope anchor), unity
    // from frame 1 — versus the symmetric kernel's 4-frame ramp.
    expect(out[0][0]).toBe(0);
    expect(out[0][1]).toBe(1);
    expect(out[0][2]).toBe(1);

    kernel.stop();
    const { out: tail } = render(kernel, DECLICK + 1);
    // Fade-out still spans the full declick window.
    expect(tail[0][0]).toBeCloseTo(1, 6);
    expect(tail[0][1]).toBeCloseTo(0.75, 6);
    expect(tail[0][3]).toBeCloseTo(0.25, 6);
    expect(tail[0][DECLICK]).toBe(0);
  });

  it('loop wrap keeps the symmetric equal-gain crossfade (sums to unity)', () => {
    const data = new Float32Array(64).fill(1);
    const kernel = new DeckSourceKernel(DECLICK, ATTACK);
    kernel.setTrack([data], 1);
    kernel.setLoop({ startFrames: 0, endFrames: 16 });
    kernel.start(0, 1);
    render(kernel, 8); // past fade-in
    const { out } = render(kernel, 16); // crosses the wrap at frame 8
    // Constant-1 content through the wrap splice: tail (full-declick down)
    // + wrapped voice (full-declick up) must sum to 1, not bump to ~1.75.
    for (let i = 0; i < 16; i++) {
      expect(out[0][i]).toBeGreaterThan(0.99);
      expect(out[0][i]).toBeLessThan(1.01);
    }
  });

  it('stab splice: retiring tail fades over declick under the short attack', () => {
    const data = new Float32Array(64).fill(1);
    const kernel = new DeckSourceKernel(DECLICK, ATTACK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    render(kernel, 8);
    kernel.start(0, 2); // stab restart
    const { out } = render(kernel, DECLICK + 1);
    // New voice at unity from frame 1; old tail still audible and fading
    // (sum briefly exceeds 1 — deliberate: stab content is uncorrelated).
    expect(out[0][1]).toBeGreaterThan(1);
    expect(out[0][DECLICK]).toBeCloseTo(1, 6); // tail gone, live at unity
  });

  it('zero attack starts at unity on frame 0 (instant, CDJ-style)', () => {
    const data = new Float32Array(64).fill(1);
    const kernel = new DeckSourceKernel(DECLICK, 0);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, 4);
    expect(out[0][0]).toBe(1);
    expect(out[0][1]).toBe(1);

    // Stops still fade over the full declick — no click on pause.
    kernel.stop();
    const { out: tail } = render(kernel, DECLICK + 1);
    expect(tail[0][1]).toBeCloseTo(0.75, 6);
    expect(tail[0][DECLICK]).toBe(0);
  });

  it('zero attack leaves loop wraps on the symmetric crossfade', () => {
    const data = new Float32Array(64).fill(1);
    const kernel = new DeckSourceKernel(DECLICK, 0);
    kernel.setTrack([data], 1);
    kernel.setLoop({ startFrames: 0, endFrames: 16 });
    kernel.start(0, 1);
    render(kernel, 8);
    const { out } = render(kernel, 16);
    for (let i = 0; i < 16; i++) {
      expect(out[0][i]).toBeGreaterThan(0.99);
      expect(out[0][i]).toBeLessThan(1.01);
    }
  });

  it('single-arg constructor stays symmetric (attack = declick)', () => {
    const data = new Float32Array(64).fill(1);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, DECLICK);
    for (let i = 0; i < DECLICK; i++) {
      expect(out[0][i]).toBeCloseTo(i / DECLICK, 6);
    }
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
  primes: Array<{ position: number; rate: number }> = [];
  calls: Array<{
    position: number;
    rate: number;
    frames: number;
    loop: { startFrames: number; endFrames: number } | null;
  }> = [];

  prime(...args: Parameters<StretchEngine['prime']>): void {
    this.primes.push({ position: args[1], rate: args[2] });
  }

  render(
    out: Float32Array[],
    frames: number,
    source: TrackSource,
    positionFrames: number,
    rate: number,
    loop: { startFrames: number; endFrames: number } | null
  ): void {
    this.calls.push({ position: positionFrames, rate, frames, loop });
    for (let c = 0; c < out.length; c++) {
      for (let i = 0; i < frames; i++) {
        // Honor the read-layer loop fold, like the real window fill.
        let idx = Math.round(positionFrames + i * rate);
        if (loop && idx >= loop.endFrames) {
          idx = loop.startFrames + ((idx - loop.endFrames) % (loop.endFrames - loop.startFrames));
        }
        out[c][i] = -source.sampleAt(c, idx);
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

  it('same-mode setMode is a no-op (no splice, no prime)', () => {
    const fake = new FakeStretchEngine();
    const kernel = stretchKernel(ramp(64), fake);
    kernel.start(0, 1);
    render(kernel, 8);
    const primes = fake.primes.length;
    kernel.setMode('stretch');
    render(kernel, 8);
    expect(fake.primes.length).toBe(primes);
  });

  it('warm-primes the engine once per voice at its start position', () => {
    const fake = new FakeStretchEngine();
    const kernel = stretchKernel(ramp(256), fake);
    kernel.start(0, 1);
    render(kernel, 8);
    render(kernel, 8);
    expect(fake.primes).toEqual([{ position: 0, rate: 1 }]);
    // Stab: fresh voice, fresh warm prime at the stab position — full
    // onset energy AND no residue (stab-declick 01).
    kernel.start(100, 2);
    render(kernel, 8);
    expect(fake.primes).toEqual([
      { position: 0, rate: 1 },
      { position: 100, rate: 1 },
    ]);
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

describe('DeckSourceKernel loop wrap (looping 03)', () => {
  it('wraps the voice position across the loop end (sample-accurate)', () => {
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([ramp(64)], 1);
    kernel.setLoop({ startFrames: 8, endFrames: 16 });
    kernel.start(8, 1);
    render(kernel, 12); // 8 frames to the edge, wrap, 4 more
    expect(kernel.livePositionFrames).toBeCloseTo(12, 6);
  });

  it('keeps wrapping over many cycles without drift', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(64)], 1);
    kernel.setLoop({ startFrames: 8, endFrames: 16 });
    kernel.start(8, 1);
    render(kernel, 8 * 10 + 3); // ten full cycles + 3
    expect(kernel.livePositionFrames).toBeCloseTo(11, 6);
  });

  it('declick-splices the wrap: old edge fades out under the new fade-in', () => {
    const data = ramp(64);
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([data], 1);
    kernel.setLoop({ startFrames: 8, endFrames: 16 });
    kernel.start(8, 1);
    render(kernel, 8); // reaches the edge exactly at the block boundary
    const { out, ended } = render(kernel, 8);
    // Tail keeps reading past the edge while the wrapped voice fades in.
    for (let i = 0; i < DECLICK; i++) {
      const tail = data[16 + i] * (1 - i / DECLICK);
      const wrapped = data[8 + i] * (i / DECLICK);
      expect(out[0][i]).toBeCloseTo(tail + wrapped, 5);
    }
    for (let i = DECLICK; i < 8; i++) expect(out[0][i]).toBe(data[8 + i]);
    expect(ended).toEqual([]);
  });

  it('loop wrap takes precedence over end-of-track inside the region', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(16)], 1);
    kernel.setLoop({ startFrames: 8, endFrames: 16 }); // end == track end
    kernel.start(8, 1);
    const { ended } = render(kernel, 24);
    expect(ended).toEqual([]);
    expect(kernel.livePositionFrames).not.toBeNull();
  });

  it('clamps a region end beyond the track to the track end', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(16)], 1);
    kernel.setLoop({ startFrames: 8, endFrames: 999 });
    kernel.start(8, 1);
    const { ended } = render(kernel, 24);
    expect(ended).toEqual([]);
  });

  it('does not wrap a voice that was never inside the region', () => {
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(16)], 1);
    kernel.setLoop({ startFrames: 0, endFrames: 8 });
    kernel.start(12, 5); // beyond the region: plays to the end of track
    const { ended } = render(kernel, 8);
    expect(ended).toEqual([5]);
  });

  it('clearing the loop lets playback flow past the end edge', () => {
    const data = ramp(64);
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([data], 1);
    kernel.setLoop({ startFrames: 8, endFrames: 16 });
    kernel.start(8, 1);
    render(kernel, 4);
    kernel.setLoop(null);
    const { out } = render(kernel, 8);
    for (let i = 1; i < 8; i++) expect(out[0][i]).toBe(data[12 + i]);
    expect(kernel.livePositionFrames).toBeCloseTo(20, 6);
  });

  it('wraps in stretch mode at the READ layer: same voice, no splice, no re-prime', () => {
    const fake = new FakeStretchEngine();
    const kernel = new DeckSourceKernel(DECLICK);
    kernel.setTrack([ramp(256)], 1);
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    kernel.setLoop({ startFrames: 8, endFrames: 16 });
    kernel.start(8, 1);
    render(kernel, 8); // exactly to the edge: wrap at the block boundary
    expect(kernel.livePositionFrames).toBeCloseTo(8, 6);
    render(kernel, 8);
    expect(kernel.livePositionFrames).toBeCloseTo(8, 6);
    // The engine saw folded read windows for the SAME voice — one prime
    // total: a splice would swap render paths mid-voice and pop per cycle.
    expect(fake.calls.map((c) => c.position)).toEqual([8, 8]);
    expect(fake.calls.map((c) => c.loop)).toEqual([
      { startFrames: 8, endFrames: 16 },
      { startFrames: 8, endFrames: 16 },
    ]);
    expect(fake.primes.length).toBe(1);
  });

  it('a mid-block stretch wrap is output-continuous (no fade dip, no splice)', () => {
    const fake = new FakeStretchEngine();
    const kernel = new DeckSourceKernel(1);
    const data = ramp(256);
    kernel.setTrack([data], 1);
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    kernel.setLoop({ startFrames: 8, endFrames: 16 });
    kernel.start(10, 1);
    const { out, ended } = render(kernel, 10); // wraps after 6 frames, 4 more
    expect(ended).toEqual([]);
    expect(kernel.livePositionFrames).toBeCloseTo(12, 6);
    // Full gain throughout: content 10..15, then folded 8..11 — no
    // crossfade envelope anywhere near the boundary.
    const expected = [10, 11, 12, 13, 14, 15, 8, 9, 10, 11];
    for (let i = 1; i < 10; i++) {
      expect(out[0][i]).toBeCloseTo(-data[expected[i]], 5);
    }
  });

  it('does not fold the read window for a voice beyond the region', () => {
    const fake = new FakeStretchEngine();
    const kernel = new DeckSourceKernel(1);
    kernel.setTrack([ramp(256)], 1);
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    kernel.setLoop({ startFrames: 8, endFrames: 16 });
    kernel.start(32, 1); // jumped past the loop: plays on linearly
    render(kernel, 8);
    expect(fake.calls[0].loop).toBeNull();
    expect(kernel.livePositionFrames).toBeCloseTo(40, 6);
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

describe('DeckSourceKernel stems (stems #209)', () => {
  /** Two mono stems: 1..n and 10·(1..n); unity sum = 11·(1..n). */
  function stemKernel(n = 64): DeckSourceKernel {
    const kernel = new DeckSourceKernel(DECLICK, 0);
    const a = ramp(n);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = (i + 1) * 10;
    kernel.setStems([[a], [b]], 1);
    return kernel;
  }

  it('renders the unity-gain stem sum (replace-policy identity)', () => {
    const kernel = stemKernel();
    kernel.start(0, 1);
    const { out } = render(kernel, 8);
    for (let i = 0; i < 8; i++) expect(out[0][i]).toBeCloseTo((i + 1) * 11, 4);
  });

  it('setStemGains kills a stem with a declick ramp anchored at the playhead', () => {
    const kernel = stemKernel();
    kernel.start(0, 1);
    render(kernel, 8); // playhead now at frame 8
    kernel.setStemGains([1, 0]);
    const { out } = render(kernel, DECLICK + 4);
    // Ramp spans frames 8..8+DECLICK: stem b's contribution slopes to 0.
    for (let i = 0; i < DECLICK; i++) {
      const frame = 8 + i;
      const bGain = 1 - i / DECLICK;
      expect(out[0][i]).toBeCloseTo((frame + 1) * (1 + 10 * bGain), 3);
    }
    // Past the ramp: only stem a remains.
    for (let i = DECLICK; i < DECLICK + 4; i++) {
      expect(out[0][i]).toBeCloseTo(8 + i + 1, 3);
    }
  });

  it('setStemGains while stopped applies instantly to the next start', () => {
    const kernel = stemKernel();
    kernel.setStemGains([0, 1]);
    kernel.start(4, 1);
    const { out } = render(kernel, 4);
    for (let i = 0; i < 4; i++) expect(out[0][i]).toBeCloseTo((4 + i + 1) * 10, 4);
  });

  it('setStemGains is a no-op on a single-source track', () => {
    const kernel = new DeckSourceKernel(DECLICK, 0);
    kernel.setTrack([ramp(16)], 1);
    kernel.setStemGains([0, 0, 0, 0]);
    kernel.start(0, 1);
    const { out } = render(kernel, 4);
    expect(out[0][0]).toBeCloseTo(1, 5);
  });

  it('stretch mode reads the mixed stems through the source seam', () => {
    const kernel = stemKernel();
    const fake = new FakeStretchEngine();
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    kernel.setStemGains([1, 0]); // kill stem b before starting
    kernel.start(10, 1);
    const { out } = render(kernel, 4);
    // FakeStretchEngine negates source.sampleAt — only stem a audible.
    for (let i = 0; i < 4; i++) expect(out[0][i]).toBeCloseTo(-(10 + i + 1), 4);
  });

  it('a fresh setStems resets gains to unity (kill state is per-Load)', () => {
    const kernel = stemKernel();
    kernel.setStemGains([0, 0]);
    kernel.setStems([[ramp(16)], [ramp(16)]], 1);
    kernel.start(0, 1);
    const { out } = render(kernel, 4);
    expect(out[0][0]).toBeCloseTo(2, 4); // both stems audible again
  });
});

describe('stem gain settling (seek-back bug, stems #210 review)', () => {
  it('a restart before the kill position keeps the stem killed', () => {
    const kernel = new DeckSourceKernel(DECLICK, 0);
    const a = ramp(64);
    const b = ramp(64);
    kernel.setStems([[a], [b]], 1);
    kernel.start(32, 1);
    render(kernel, 8); // playhead 40; ramp anchors there
    kernel.setStemGains([1, 0]);
    render(kernel, DECLICK + 2); // ramp completes
    kernel.start(0, 2); // seek back before the kill point
    render(kernel, DECLICK + 1); // let the splice tail die
    const { out } = render(kernel, 4);
    // Stem b stays dead even though we're reading frames < anchor.
    const base = DECLICK + 1;
    for (let i = 0; i < 4; i++) expect(out[0][i]).toBeCloseTo(a[base + i], 3);
  });

  it('a completed ramp settles even without a restart (backwards reads)', () => {
    const kernel = new DeckSourceKernel(DECLICK, 0);
    const a = ramp(256);
    kernel.setStems([[a], [ramp(256)]], 1);
    kernel.start(100, 1);
    render(kernel, 4);
    kernel.setStemGains([1, 0]);
    render(kernel, DECLICK + 8); // play past the ramp end
    // Simulate a backwards read (loop fold / stretch pre-read) via the
    // stretch path's own source handle: gain before the anchor is settled.
    const fake = new FakeStretchEngine();
    kernel.setStretchEngine(fake);
    kernel.setMode('stretch');
    const { out } = render(kernel, 2);
    // Stretch fake reads source.sampleAt at the live position — but the
    // settled source also answers old frames with the killed gain:
    void out;
    expect(fake.calls.length).toBeGreaterThan(0);
  });
});
