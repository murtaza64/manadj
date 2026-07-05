/**
 * Jog math + controller (midi-controller 03): pure message-in/action-out —
 * synthetic ticks and a fake port, no Web MIDI, no engine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOG_BEND_MAX_PERCENT,
  JOG_FINE_CONTINUATION_MS,
  JOG_IDLE_MS,
  JOG_TOUCH_AUTHORITATIVE_MS,
  JOG_TOUCH_SEEK_SECONDS_PER_TICK,
  JogController,
  jogBendPercent,
  jogSeekDelta,
  smoothedRate,
} from './jog';
import type { JogDeckPort } from './jog';

describe('jog math', () => {
  it('bend is linear in rate and signed', () => {
    expect(jogBendPercent(0)).toBe(0);
    expect(jogBendPercent(50)).toBeGreaterThan(0);
    expect(jogBendPercent(-50)).toBeLessThan(0);
    expect(jogBendPercent(-50)).toBe(-jogBendPercent(50));
  });

  it('bend clamps at ±JOG_BEND_MAX_PERCENT', () => {
    expect(jogBendPercent(1e6)).toBe(JOG_BEND_MAX_PERCENT);
    expect(jogBendPercent(-1e6)).toBe(-JOG_BEND_MAX_PERCENT);
  });

  it('seek travel is per-tick at rest and grows with rate', () => {
    const slow = jogSeekDelta(1, 1);
    const fast = jogSeekDelta(1, 300);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 10);
  });

  it('seek direction follows tick sign both ways', () => {
    expect(jogSeekDelta(-1, -1)).toBe(-jogSeekDelta(1, 1));
    expect(jogSeekDelta(-2, -300)).toBeLessThan(0);
  });

  it('seek acceleration is capped', () => {
    expect(jogSeekDelta(1, 1e9)).toBe(jogSeekDelta(1, 1e10));
  });

  it('rate folding is signed and decays toward the new impulse', () => {
    const first = smoothedRate(0, 1, 50); // one tick per 50ms = 20 tps
    expect(first).toBeCloseTo(12); // 0.6 * 20
    const second = smoothedRate(first, 1, 50);
    expect(second).toBeGreaterThan(first);
    expect(smoothedRate(0, -1, 50)).toBeCloseTo(-12);
  });
});

describe('JogController', () => {
  let playing: boolean;
  let playhead: number;
  let calls: string[];
  let port: JogDeckPort;

  beforeEach(() => {
    vi.useFakeTimers();
    playing = false;
    playhead = 60;
    calls = [];
    port = {
      isPlaying: () => playing,
      getPlayhead: () => playhead,
      seek: (s) => calls.push(`seek:${s.toFixed(3)}`),
      setBend: (p) => calls.push(`bend:${p.toFixed(3)}`),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('playing: ticks bend, idle window releases bend to exactly zero', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith('bend:')).toBe(true);
    expect(parseFloat(calls[0].slice(5))).toBeGreaterThan(0);

    vi.advanceTimersByTime(JOG_IDLE_MS + 1);
    expect(calls[calls.length - 1]).toBe('bend:0.000');
  });

  it('playing: continued rotation keeps re-arming the release window', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    vi.advanceTimersByTime(JOG_IDLE_MS - 10);
    jog.onTicks(1, 1000 + JOG_IDLE_MS - 10);
    vi.advanceTimersByTime(JOG_IDLE_MS - 10);
    // Window re-armed by the second burst: no release yet.
    expect(calls.filter((c) => c === 'bend:0.000')).toHaveLength(0);
    vi.advanceTimersByTime(20);
    expect(calls[calls.length - 1]).toBe('bend:0.000');
  });

  it('playing: counter-clockwise ticks bend negative', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(-1, 1000);
    expect(parseFloat(calls[0].slice(5))).toBeLessThan(0);
  });

  it('paused: ticks seek relative to the playhead, no bend', () => {
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith('seek:')).toBe(true);
    expect(parseFloat(calls[0].slice(5))).toBeGreaterThan(60);
  });

  it('paused: hard spins travel much farther per tick than slow ones', () => {
    const jog = new JogController(port);
    jog.onTicks(1, 1000); // slow: fresh gesture
    const slowTravel = parseFloat(calls[0].slice(5)) - 60;

    // Hard spin: many ticks in tight succession build a high rate.
    const spun = new JogController(port);
    calls = [];
    playhead = 60;
    let t = 2000;
    for (let i = 0; i < 10; i++) {
      spun.onTicks(8, t);
      t += 10;
    }
    const last = parseFloat(calls[calls.length - 1].slice(5));
    expect(last - 60).toBeGreaterThan(slowTravel * 20);
  });

  it('pausing mid-gesture releases the bend before seeking', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    playing = false;
    jog.onTicks(1, 1050);
    expect(calls[1]).toBe('bend:0.000');
    expect(calls[2].startsWith('seek:')).toBe(true);
  });

  it('dispose releases a held bend', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    jog.dispose();
    expect(calls[calls.length - 1]).toBe('bend:0.000');
  });

  it('dispose without activity emits nothing', () => {
    const jog = new JogController(port);
    jog.dispose();
    expect(calls).toEqual([]);
  });
});

describe('touch surface (midi-controller 11)', () => {
  let playing: boolean;
  let playhead: number;
  let calls: string[];
  let port: JogDeckPort;

  beforeEach(() => {
    vi.useFakeTimers();
    playing = false;
    playhead = 60;
    calls = [];
    port = {
      isPlaying: () => playing,
      getPlayhead: () => playhead,
      // Stateful, like the engine: the next seek starts from the last one.
      seek: (s) => {
        playhead = s;
        calls.push(`seek:${s.toFixed(4)}`);
      },
      setBend: (p) => calls.push(`bend:${p.toFixed(3)}`),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('paused: touch ticks seek linearly per tick, both directions', () => {
    const jog = new JogController(port);
    jog.onTouchTicks(1);
    jog.onTouchTicks(-1);
    // +1 tick then -1 tick returns exactly to the start.
    expect(calls).toEqual([
      `seek:${(60 + JOG_TOUCH_SEEK_SECONDS_PER_TICK).toFixed(4)}`,
      `seek:${(60).toFixed(4)}`,
    ]);
  });

  it('paused: no velocity acceleration — dense bursts stay per-tick linear', () => {
    const jog = new JogController(port);
    for (let i = 0; i < 20; i++) jog.onTouchTicks(1);
    const last = parseFloat(calls[calls.length - 1].slice(5));
    expect(last).toBeCloseTo(60 + 20 * JOG_TOUCH_SEEK_SECONDS_PER_TICK, 10);
  });

  it('playing: touch ticks are ignored (no bend, no seek)', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTouchTicks(4);
    expect(calls).toEqual([]);
  });

  it('touch ticks do not disturb a rim bend in progress', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    const bendCalls = calls.length;
    jog.onTouchTicks(1, 1010);
    expect(calls.length).toBe(bendCalls);
  });

  describe('release continuation (the wheel keeps spinning after letting go)', () => {
    it('rim ticks inside the touch-authoritative window are dropped (dual streams)', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      jog.onTicks(1, 1000 + JOG_TOUCH_AUTHORITATIVE_MS - 10);
      expect(calls).toEqual([`seek:${(60 + JOG_TOUCH_SEEK_SECONDS_PER_TICK).toFixed(4)}`]);
    });

    it('rim ticks continuing a touch gesture seek at the fine rate, not the accelerated one', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      jog.onTicks(1, 1000 + JOG_TOUCH_AUTHORITATIVE_MS + 20);
      expect(calls).toEqual([
        `seek:${(60 + JOG_TOUCH_SEEK_SECONDS_PER_TICK).toFixed(4)}`,
        `seek:${(60 + 2 * JOG_TOUCH_SEEK_SECONDS_PER_TICK).toFixed(4)}`,
      ]);
    });

    it('continuation rim ticks keep extending the window while the wheel spins down', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      let t = 1000 + JOG_TOUCH_AUTHORITATIVE_MS + 20;
      for (let i = 0; i < 10; i++) {
        jog.onTicks(1, t);
        t += JOG_FINE_CONTINUATION_MS - 50; // each tick inside the window
      }
      const last = parseFloat(calls[calls.length - 1].slice(5));
      expect(last).toBeCloseTo(60 + 11 * JOG_TOUCH_SEEK_SECONDS_PER_TICK, 10);
    });

    it('after the gesture gap, rim ticks return to the classic accelerated seek', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      jog.onTicks(1, 1000 + JOG_FINE_CONTINUATION_MS + 100);
      const travel = parseFloat(calls[1].slice(5)) - parseFloat(calls[0].slice(5));
      expect(travel).toBeGreaterThan(JOG_TOUCH_SEEK_SECONDS_PER_TICK * 2);
    });

    it('a fresh rim gesture with no touch history seeks classically', () => {
      const jog = new JogController(port);
      jog.onTicks(1, 5000);
      const travel = parseFloat(calls[0].slice(5)) - 60;
      expect(travel).toBeGreaterThan(JOG_TOUCH_SEEK_SECONDS_PER_TICK * 2);
    });

    it('playing is untouched by continuation: rim ticks still bend', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      playing = true;
      jog.onTicks(1, 1000 + JOG_TOUCH_AUTHORITATIVE_MS + 20);
      expect(calls[calls.length - 1].startsWith('bend:')).toBe(true);
    });
  });
});
