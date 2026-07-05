/**
 * Jog math + controller (midi-controller 03): pure message-in/action-out —
 * synthetic ticks and a fake port, no Web MIDI, no engine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOG_BEND_FILTER_PERIOD_MS,
  JOG_BEND_FILTER_WINDOW,
  JOG_BEND_MAX_PERCENT,
  JOG_BEND_PERCENT_PER_TICK,
  JOG_FINE_CONTINUATION_MS,
  JOG_SEEK_SECONDS_PER_TICK,
  JOG_TOUCH_SEEK_SECONDS_PER_TICK,
  JogController,
  bendFromWindowAverage,
  jogSeekDelta,
  smoothedRate,
} from './jog';
import type { JogDeckPort } from './jog';

describe('jog math', () => {
  it('bend is linear in the window average and signed', () => {
    expect(bendFromWindowAverage(0)).toBe(0);
    expect(bendFromWindowAverage(0.2)).toBeCloseTo(0.2 * JOG_BEND_PERCENT_PER_TICK, 10);
    expect(bendFromWindowAverage(-0.2)).toBe(-bendFromWindowAverage(0.2));
  });

  it('bend clamps at ±JOG_BEND_MAX_PERCENT', () => {
    expect(bendFromWindowAverage(1e6)).toBe(JOG_BEND_MAX_PERCENT);
    expect(bendFromWindowAverage(-1e6)).toBe(-JOG_BEND_MAX_PERCENT);
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

  it('playing: accumulated ticks bend after one filter period, sign follows direction', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(4, 1000);
    expect(calls).toHaveLength(0); // nothing until the filter drains
    vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS);
    expect(calls).toEqual([
      `bend:${((4 / JOG_BEND_FILTER_WINDOW) * JOG_BEND_PERCENT_PER_TICK).toFixed(3)}`,
    ]);

    const ccw = new JogController(port);
    calls = [];
    ccw.onTicks(-4, 2000);
    vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS);
    expect(parseFloat(calls[0].slice(5))).toBeLessThan(0);
    ccw.dispose();
    jog.dispose();
  });

  it('playing: bend springs back to exactly zero, stepwise, after rotation stops', () => {
    playing = true;
    const jog = new JogController(port);
    // Sustained rotation: 1 tick per period for 10 periods.
    for (let i = 0; i < 10; i++) {
      jog.onTicks(1, 1000 + i * JOG_BEND_FILTER_PERIOD_MS);
      vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS);
    }
    const peak = parseFloat(calls[calls.length - 1].slice(5));
    expect(peak).toBeCloseTo((10 / JOG_BEND_FILTER_WINDOW) * JOG_BEND_PERCENT_PER_TICK, 10);

    // Stop feeding: the window empties slot by slot — monotone decay to 0.
    const before = calls.length;
    vi.advanceTimersByTime(JOG_BEND_FILTER_WINDOW * JOG_BEND_FILTER_PERIOD_MS);
    const decay = calls.slice(before).map((c) => parseFloat(c.slice(5)));
    for (let i = 1; i < decay.length; i++) expect(decay[i]).toBeLessThan(decay[i - 1]);
    expect(calls[calls.length - 1]).toBe('bend:0.000');

    // The filter stops itself: no further engine calls.
    const settled = calls.length;
    vi.advanceTimersByTime(10 * JOG_BEND_FILTER_PERIOD_MS);
    expect(calls.length).toBe(settled);
  });

  it('playing: a violent spin clamps at ±JOG_BEND_MAX_PERCENT', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(100, 1000);
    vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS);
    expect(calls[0]).toBe(`bend:${JOG_BEND_MAX_PERCENT.toFixed(3)}`);
    jog.dispose();
  });

  it('playing: steady rotation holds a steady bend without engine spam', () => {
    playing = true;
    const jog = new JogController(port);
    for (let i = 0; i < JOG_BEND_FILTER_WINDOW + 10; i++) {
      jog.onTicks(1, 1000 + i * JOG_BEND_FILTER_PERIOD_MS);
      vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS);
    }
    // Window full of 1s: value stable, so setBend stops being re-sent.
    const stable = calls[calls.length - 1];
    expect(stable).toBe(
      `bend:${Math.min((1 * JOG_BEND_PERCENT_PER_TICK), JOG_BEND_MAX_PERCENT).toFixed(3)}`
    );
    expect(calls.filter((c) => c === stable).length).toBe(1);
    jog.dispose();
  });

  it('paused: rim ticks seek relative to the playhead, no bend', () => {
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith('seek:')).toBe(true);
    expect(parseFloat(calls[0].slice(5))).toBeGreaterThan(60);
  });

  it('paused: bare rim spins are GENTLE — linear per tick, no velocity surprise (issue 12)', () => {
    const jog = new JogController(port);
    // Hard spin: many ticks in tight succession. The playhead is pinned at
    // 60 in this harness, so every call must travel exactly ticks × base —
    // a velocity term would make later calls travel farther.
    let t = 1000;
    for (let i = 0; i < 10; i++) {
      jog.onTicks(8, t);
      t += 10;
    }
    const expected = `seek:${(60 + 8 * JOG_SEEK_SECONDS_PER_TICK).toFixed(3)}`;
    expect(calls).toHaveLength(10);
    expect(calls.every((c) => c === expected)).toBe(true);
  });

  it('SHIFT+wheel: hard spins travel much farther per tick than slow ones', () => {
    const jog = new JogController(port);
    jog.onSeekTicks(1, 1000); // slow: fresh gesture
    const slowTravel = parseFloat(calls[0].slice(5)) - 60;

    const spun = new JogController(port);
    calls = [];
    playhead = 60;
    let t = 2000;
    for (let i = 0; i < 10; i++) {
      spun.onSeekTicks(8, t);
      t += 10;
    }
    const last = parseFloat(calls[calls.length - 1].slice(5));
    expect(last - 60).toBeGreaterThan(slowTravel * 20);
  });

  it('SHIFT+wheel: seeks while playing too, releasing any bend first', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS); // bend applied
    jog.onSeekTicks(1, 1030);
    expect(calls[calls.length - 2]).toBe('bend:0.000');
    expect(calls[calls.length - 1].startsWith('seek:')).toBe(true);
  });

  it('pausing mid-gesture releases the bend before seeking', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS); // bend applied
    playing = false;
    jog.onTicks(1, 1050);
    expect(calls[1]).toBe('bend:0.000');
    expect(calls[2].startsWith('seek:')).toBe(true);
  });

  it('dispose releases a held bend', () => {
    playing = true;
    const jog = new JogController(port);
    jog.onTicks(1, 1000);
    vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS);
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
    vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS); // bend applied
    const bendCalls = calls.length;
    expect(bendCalls).toBeGreaterThan(0);
    jog.onTouchTicks(1, 1010);
    expect(calls.length).toBe(bendCalls);
    jog.dispose();
  });

  describe('release continuation (the wheel keeps spinning after letting go)', () => {
    it('rim ticks continue IMMEDIATELY after touch ticks at the fine rate (no release gap)', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      // The streams are mutually exclusive on this hardware: the first rim
      // tick right after release must seek, not be deduped away.
      jog.onTicks(1, 1010);
      expect(calls).toEqual([
        `seek:${(60 + JOG_TOUCH_SEEK_SECONDS_PER_TICK).toFixed(4)}`,
        `seek:${(60 + 2 * JOG_TOUCH_SEEK_SECONDS_PER_TICK).toFixed(4)}`,
      ]);
    });

    it('continuation rim ticks keep extending the window while the wheel spins down', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      let t = 1010;
      for (let i = 0; i < 10; i++) {
        jog.onTicks(1, t);
        t += JOG_FINE_CONTINUATION_MS - 50; // each tick inside the window
      }
      const last = parseFloat(calls[calls.length - 1].slice(5));
      expect(last).toBeCloseTo(60 + 11 * JOG_TOUCH_SEEK_SECONDS_PER_TICK, 10);
    });

    it('after the gesture gap, rim ticks return to the gentle rim rate', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      jog.onTicks(1, 1000 + JOG_FINE_CONTINUATION_MS + 100);
      const travel = parseFloat(calls[1].slice(5)) - parseFloat(calls[0].slice(5));
      expect(travel).toBeCloseTo(JOG_SEEK_SECONDS_PER_TICK, 10);
    });

    it('a fresh rim gesture with no touch history seeks at the gentle rim rate', () => {
      const jog = new JogController(port);
      jog.onTicks(1, 5000);
      const travel = parseFloat(calls[0].slice(5)) - 60;
      expect(travel).toBeCloseTo(JOG_SEEK_SECONDS_PER_TICK, 10);
    });

    it('playing is untouched by continuation: rim ticks still bend', () => {
      const jog = new JogController(port);
      jog.onTouchTicks(1, 1000);
      playing = true;
      jog.onTicks(1, 1010);
      vi.advanceTimersByTime(JOG_BEND_FILTER_PERIOD_MS);
      expect(calls[calls.length - 1].startsWith('bend:')).toBe(true);
      jog.dispose();
    });
  });

  /**
   * The editor's deck-B port (editor-midi 04): `isPlaying` pinned false and
   * `getPlayhead` pinned 0 turn the controller's absolute seeks into signed
   * slide-by-seconds deltas, keeping the three-tier feel.
   */
  describe('delta port (editor-midi 04: continuous Slide)', () => {
    let deltas: number[];
    let bends: number[];
    let deltaPort: JogDeckPort;

    beforeEach(() => {
      deltas = [];
      bends = [];
      deltaPort = {
        isPlaying: () => false,
        getPlayhead: () => 0,
        seek: (d) => deltas.push(d),
        setBend: (p) => bends.push(p),
      };
    });

    it('all three tiers emit signed deltas at their own rates, never a bend', () => {
      const jog = new JogController(deltaPort);
      jog.onTicks(2, 1000); // gentle rim tier
      jog.onTouchTicks(-3, 2000); // fine tier (gap ends any continuation)
      jog.onSeekTicks(1, 4000); // fast tier (velocity-accelerated)
      expect(deltas[0]).toBeCloseTo(2 * JOG_SEEK_SECONDS_PER_TICK, 10);
      expect(deltas[1]).toBeCloseTo(-3 * JOG_TOUCH_SEEK_SECONDS_PER_TICK, 10);
      expect(deltas[2]).toBeGreaterThanOrEqual(JOG_SEEK_SECONDS_PER_TICK);
      vi.advanceTimersByTime(10 * JOG_BEND_FILTER_PERIOD_MS);
      expect(bends).toEqual([]); // a never-playing port cannot bend
      jog.dispose();
    });

    it('deltas are relative to zero — travel never accumulates into the next gesture', () => {
      const jog = new JogController(deltaPort);
      jog.onTicks(1, 1000);
      jog.onTicks(1, 2000);
      expect(deltas[0]).toBeCloseTo(deltas[1], 10);
      jog.dispose();
    });
  });
});
