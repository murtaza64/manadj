import { describe, expect, it, vi } from 'vitest';
import { DeckSourceKernel } from './deckSourceKernel';
import { moveScratch, scratchPosition } from './scratchMotion';
import type { ScratchMotion } from './scratchMotion';
import { JogController, JOG_RELEASE_IDLE_MS } from '../../midi/jog';
import { GRV6_JOG_CALIBRATION } from '../../midi/jogCalibration';
import { planReplay } from '../../sessions/replayPlanner';
import type { CaptureEvent } from '../../capture/events';

describe('scratch quality regressions', () => {
  it.each([-1, 1])('replays EOF-straddling transport loops as effective scratch loops (direction=%s)', direction => {
    const loop = { start: 99, end: 101 };
    const motion: ScratchMotion = { position: direction > 0 ? 99.9 : 99.1, time: 1,
      drive: direction * 16, rate: direction * 16, trackDuration: 100, loop: { start: 99, end: 100 } };
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'loop', channel: 'A', region: loop, playhead: motion.position },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: motion.position, trackDuration: 100 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: motion.position,
        trackDuration: 100, filter: { drive: motion.drive, rate: motion.rate } },
      { t: 2, kind: 'tick', playheads: {} },
    ];
    const result = planReplay(events, 1.012);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const seed = result.plan.seed.decks.A;
    expect(seed.loop).toEqual(loop); // Transport intent is not truncated.
    const data = Float32Array.from({ length: 100000 }, (_, i) => Math.sin(i * 0.2));
    const live = new DeckSourceKernel(5);
    const replay = new DeckSourceKernel(5);
    live.setTrack([data], 1);
    replay.setTrack([data], 1);
    live.setScratch(motion);
    live.render([new Float32Array(12)], new Float32Array([1]), 1, 1000);
    expect(seed.playhead * 1000).toBeCloseTo(live.livePositionFrames!, 8);
    replay.setScratch({ ...motion, ...seed.scratch!, position: seed.playhead, time: 1.012 });
    const a = [new Float32Array(40)];
    const b = [new Float32Array(40)];
    live.render(a, new Float32Array([1]), 1.012, 1000);
    replay.render(b, new Float32Array([1]), 1.012, 1000);
    expect(replay.livePositionFrames).toBeCloseTo(live.livePositionFrames!, 8);
    for (let i = 6; i < 40; i++) expect(b[0][i]).toBeCloseTo(a[0][i], 6);
  });
  it('preserves EOF turning-point clipping when seeking into captured scratch PCM', () => {
    const motion: ScratchMotion = { position: 99.999, time: 1, drive: -8, rate: 8, trackDuration: 100, loop: null };
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: motion.position },
      { t: 1, kind: 'transport', channel: 'A', action: 'scratchMove', playhead: motion.position,
        trackDuration: 100, filter: { drive: -8, rate: 8 } },
      { t: 2, kind: 'tick', playheads: {} },
    ];
    const result = planReplay(events, 1.012);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const seed = result.plan.seed.decks.A;
    expect(seed.playhead).toBeCloseTo(99.997876, 5);
    const data = Float32Array.from({ length: 100000 }, (_, i) => Math.sin(i * 0.2));
    const live = new DeckSourceKernel(5);
    const replay = new DeckSourceKernel(5);
    live.setTrack([data], 1);
    replay.setTrack([data], 1);
    live.setScratch(motion);
    live.render([new Float32Array(12)], new Float32Array([1]), 1, 1000);
    replay.setScratch({ ...motion, ...seed.scratch!, position: seed.playhead, time: 1.012 });
    const a = [new Float32Array(40)];
    const b = [new Float32Array(40)];
    live.render(a, new Float32Array([1]), 1.012, 1000);
    replay.render(b, new Float32Array([1]), 1.012, 1000);
    expect(replay.livePositionFrames).toBeCloseTo(live.livePositionFrames!, 8);
    for (let i = 6; i < 40; i++) expect(b[0][i]).toBeCloseTo(a[0][i], 6);
  });
  it.each([48000, 44100])('does not packet-fade steady motion at %s Hz', sr => {
    for (const direction of [-1, 1]) {
      const kernel = new DeckSourceKernel(Math.round(sr * 0.005));
      kernel.setTrack([new Float32Array(sr * 4).fill(1)], 1);
      let motion: ScratchMotion = { position: 2, time: 0, drive: 0,
        rate: 0, trackDuration: 4, loop: null };
      let minimum = 1;
      for (let packet = 0; packet < 180; packet++) {
        const start = Math.round(packet * sr * 0.005);
        const end = Math.round((packet + 1) * sr * 0.005);
        motion = moveScratch(motion, start / sr, direction * 20 * 0.00027, 0.005);
        kernel.setScratch(motion);
        for (let frame = start; frame < end; frame += 128) {
          const out = [new Float32Array(Math.min(128, end - frame))];
          kernel.render(out, new Float32Array([1]), frame / sr, sr);
          if (packet > 20) for (const sample of out[0]) minimum = Math.min(minimum, sample);
        }
      }
      expect(minimum).toBeGreaterThan(0.98);
    }
  });

  it('keeps packet-cadence sidebands below -24 dBc on a resampled 1 kHz tone', () => {
    const sr = 48000;
    const kernel = new DeckSourceKernel(240);
    kernel.setTrack([Float32Array.from({ length: sr * 4 }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / sr))], 1);
    let motion: ScratchMotion = { position: 2, time: 0, drive: 0, rate: 0, trackDuration: 4, loop: null };
    const output = new Float32Array(sr);
    for (let i = 0; i < 200; i++) {
      motion = moveScratch(motion, i * 0.005, 0.0054, 0.005);
      kernel.setScratch(motion);
      kernel.render([output.subarray(i * 240, (i + 1) * 240)], new Float32Array([1]), i * 0.005, sr);
    }
    const amplitude = (frequency: number) => {
      let real = 0;
      let imaginary = 0;
      for (let i = sr * 0.1; i < sr * 0.9; i++) {
        real += output[i] * Math.cos(2 * Math.PI * frequency * i / sr);
        imaginary += output[i] * Math.sin(2 * Math.PI * frequency * i / sr);
      }
      return Math.hypot(real, imaginary);
    };
    const carrier = amplitude(1080);
    // Residual velocity ripple is FM, not the old -13.6 dBc packet gain chop.
    for (const frequency of [880, 1280]) expect(20 * Math.log10(amplitude(frequency) / carrier)).toBeLessThan(-24);
  });

  it.each([true, false])('hand-up after %s motion ends the scratch at once', moving => {
    vi.useFakeTimers();
    try {
      let active = false;
      const end = vi.fn(() => { active = false; });
      const jog = new JogController({ isPlaying: () => true, getPlayhead: () => 10,
        seek: vi.fn(), setBend: vi.fn(), scratch: { isActive: () => active,
          vinylMode: () => true, begin: () => { active = true; }, move: vi.fn(),
          rate: () => 1, end } });
      jog.onTouch(true, 0);
      if (moving) jog.onTouchTicks(20, 10, GRV6_JOG_CALIBRATION, 'grv6');
      const now = moving ? 11 : 35; // fresh motion coasts; stale motion ends.
      jog.onTouch(false, now);
      expect(end).toHaveBeenCalledTimes(moving ? 0 : 1);
      if (moving) {
        vi.advanceTimersByTime(JOG_RELEASE_IDLE_MS);
        expect(end).toHaveBeenCalledOnce();
      }
      expect(vi.getTimerCount()).toBe(0);
      jog.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('ordinary release crossfades without a doubled-gain DC transient', () => {
    const sr = 48000;
    const kernel = new DeckSourceKernel(240, 0);
    kernel.setTrack([new Float32Array(sr).fill(1)], 1);
    kernel.setScratch({ position: 0.5, time: 0, drive: 2, rate: 2, trackDuration: 1, loop: null });
    kernel.render([new Float32Array(240)], new Float32Array([1.2]), 0, sr);
    const position = kernel.livePositionFrames!;
    kernel.stop();
    kernel.start(position, 1, 0.005);
    const out = [new Float32Array(480)];
    kernel.render(out, new Float32Array([1.2]), 0.005, sr);
    expect(Math.max(...out[0])).toBeLessThanOrEqual(1.001);
    expect(Math.min(...out[0])).toBeGreaterThan(0.98);
    expect(kernel.livePositionFrames).toBeCloseTo(position + 576, 3);
  });

  it.each([48000, 44100])('smooths batched jitter without velocity spikes, reverses and stops at %s Hz', sr => {
    for (const direction of [-1, 1]) {
      const kernel = new DeckSourceKernel(Math.round(sr * 0.005));
      kernel.setTrack([new Float32Array(sr * 4).fill(1)], 1);
      let motion: ScratchMotion = { position: 2, time: 0, drive: 0, rate: 0, trackDuration: 4, loop: null };
      let frame = 0;
      let smallest = Infinity;
      let largest = 0;
      // Same 200 packets/s, deliberately delivered in short/long bursts.
      const gaps = [0.001, 0.009, 0, 0.01, 0.005, 0.005];
      let packetTime = 0;
      for (let packet = 0; packet < 120; packet++) {
        packetTime += gaps[packet % gaps.length];
        const end = Math.round(packetTime * sr);
        while (frame < end) {
          const n = Math.min(128, end - frame);
          const out = [new Float32Array(n)];
          const before = scratchPosition(motion, frame / sr);
          kernel.render(out, new Float32Array([1]), frame / sr, sr);
          if (frame > sr * 0.1) {
            const speed = direction * (kernel.livePositionFrames! / sr - before) * sr / n;
            smallest = Math.min(smallest, speed);
            largest = Math.max(largest, speed);
            expect(Math.min(...out[0])).toBeGreaterThan(0.98);
          }
          frame += n;
        }
        motion = moveScratch(motion, frame / sr, direction * 0.0054, Math.max(0.001, gaps[packet % gaps.length]));
        kernel.setScratch(motion);
      }
      expect(smallest).toBeGreaterThan(0.75);
      expect(largest).toBeLessThan(1.45);
      expect(scratchPosition(motion, packetTime + 1)).toBeCloseTo(2 + direction * 0.648, 9);
      for (let i = 0; i < 4; i++) {
        const time = packetTime + i * 0.005;
        motion = moveScratch(motion, time, -direction * 0.0054, 0.005);
      }
      const at20 = scratchPosition(motion, packetTime + 0.02);
      const at21 = scratchPosition(motion, packetTime + 0.021);
      expect(direction * (at21 - at20)).toBeLessThan(0);
      kernel.setScratch(motion);
      let previousGain = 1;
      for (let ms = 30; ms < 120; ms++) {
        const time = packetTime + ms / 1000;
        const out = [new Float32Array(Math.floor(sr / 1000))];
        kernel.render(out, new Float32Array([1]), time, sr);
        const gain = out[0].at(-1)!;
        expect(gain).toBeLessThanOrEqual(previousGain + 0.00001);
        if (ms > 90) expect(gain).toBe(0);
        previousGain = gain;
      }
    }
  });

  it.each([48000, 44100].flatMap(sr => [false, true].map(looped => ({ sr, looped }))))(
    'replays captured PCM after seeking inside paused scratch ($sr Hz, looped=$looped)', ({ sr, looped }) => {
    const loop = looped ? { start: 2, end: 2.02 } : null;
    const data = Float32Array.from({ length: sr * 4 }, (_, i) => Math.sin(2 * Math.PI * 137 * i / sr));
    const live = new DeckSourceKernel(Math.round(sr * 0.005));
    const replay = new DeckSourceKernel(Math.round(sr * 0.005));
    live.setTrack([data], 1);
    replay.setTrack([data], 1);
    const events: CaptureEvent[] = [
      { t: 0, kind: 'load', channel: 'A', trackId: 1, bpm: 120 },
      { t: 0, kind: 'loop', channel: 'A', playhead: 2.01, region: loop },
      { t: 0, kind: 'transport', channel: 'A', action: 'scratchBegin', playhead: 2.01 },
    ];
    let motion: ScratchMotion = { position: 2.01, time: 0, drive: 0, rate: 0, trackDuration: 4, loop };
    const frames = [];
    for (let i = 0; i < 80; i++) {
      motion = moveScratch(motion, i * 0.005, (i % 12 < 6 ? 1 : -1) * 0.0054, 0.005);
      frames.push({ time: motion.time, motion, position: motion.position, playing: false, loop,
        rate: 1, mode: 'resample' as const, startId: i });
      events.push({ t: motion.time, kind: 'transport', channel: 'A', action: 'scratchMove',
        playhead: motion.position, filter: { drive: motion.drive, rate: motion.rate } });
    }
    events.push({ t: 0.5, kind: 'tick', playheads: {} });
    live.scheduleScratch(frames);
    const seekFrame = Math.round(0.117 * sr);
    const seek = seekFrame / sr;
    const result = planReplay(events, seek);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const seed = result.plan.seed.decks.A;
    replay.scheduleScratch([
      { time: seek, motion: { ...seed.scratch!, position: seed.playhead, time: seek, trackDuration: 4, loop },
        position: seed.playhead, playing: false, loop, rate: 1, mode: 'resample', startId: 0 },
      ...result.plan.scratchSchedules[0].frames.map(f => ({ ...f, time: f.time + seek,
        motion: f.motion ? { ...f.motion, trackDuration: 4, time: f.motion.time + seek } : null,
        mode: 'resample' as const, startId: 1 })),
    ]);
    live.render([new Float32Array(seekFrame)], new Float32Array([1]), 0, sr);
    let maximumError = 0;
    for (let offset = 0; offset < sr * 0.25; offset += 128) {
      const a = [new Float32Array(128)];
      const b = [new Float32Array(128)];
      live.render(a, new Float32Array([1]), seek + offset / sr, sr);
      replay.render(b, new Float32Array([1]), seek + offset / sr, sr);
      expect(replay.livePositionFrames).toBeCloseTo(live.livePositionFrames!, 7);
      // Replay's deliberate startup declick is not captured signal.
      if (offset > sr * 0.005) for (let i = 0; i < 128; i++) maximumError = Math.max(maximumError, Math.abs(a[0][i] - b[0][i]));
    }
    expect(maximumError).toBeLessThan(0.00001);
  });
});

it('keeps slow scratches at full level; only a stopping platter fades (gain knee)', async () => {
  const { scratchGain, SCRATCH_FULL_GAIN_RATE, SCRATCH_SILENT_RATE } = await import('./scratchMotion');
  expect(scratchGain(1)).toBe(1);
  expect(scratchGain(-0.5)).toBe(1);
  expect(scratchGain(0.1)).toBe(1); // a slow baby scratch is not attenuated
  expect(scratchGain(SCRATCH_FULL_GAIN_RATE)).toBe(1);
  expect(scratchGain((SCRATCH_FULL_GAIN_RATE + SCRATCH_SILENT_RATE) / 2)).toBeCloseTo(0.5, 6);
  expect(scratchGain(SCRATCH_SILENT_RATE)).toBe(0);
  expect(scratchGain(0)).toBe(0);
});
