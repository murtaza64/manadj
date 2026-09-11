import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mouseSeekDelta } from './mouseControl';
import { MouseJogController } from './mouseJog';
import type { MouseJogPort } from './mouseJog';
import { DEFAULT_MOUSE_JOG_SETTINGS, mouseJogBendTarget } from './mouseJogSettings';

function recordingPort() {
  const state = { playing: true, scratching: false, vinylMode: true };
  let playhead = 60;
  return {
    state,
    getSnapshot: () => state,
    getPlayhead: () => playhead,
    seek: vi.fn((seconds: number) => { playhead = seconds; }),
    setBend: vi.fn<(percent: number) => void>(),
    beginScratch: vi.fn(() => { state.scratching = true; }),
    scratchMove: vi.fn<(deltaSeconds: number, durationSeconds: number) => void>(),
    endScratch: vi.fn(() => { state.scratching = false; }),
  } satisfies MouseJogPort & { state: typeof state };
}

describe('mouse jog', () => {
  let port: ReturnType<typeof recordingPort>;
  let jog: MouseJogController;
  const bends = () => port.setBend.mock.calls.map(([bend]) => bend);
  const lastBend = () => bends().at(-1) ?? 0;
  const sustain = (velocity: number, durationMs = 3000, batchMs = 10, eventElapsed = batchMs) => {
    for (let time = 0; time < durationMs; time += batchMs) {
      jog.move(velocity * batchMs / 1000, eventElapsed);
      vi.advanceTimersByTime(batchMs);
    }
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    port = recordingPort();
    // Keep the timing fixtures fixed; product defaults are covered by settings tests.
    jog = new MouseJogController(port, () => ({ sensitivity: 1, acceleration: 1.5, smoothingMs: 50 }));
  });

  afterEach(() => {
    jog.dispose();
    vi.useRealTimers();
  });

  it.each([
    [200, 0.04868645], [600, 0.25298221], [1200, 0.71554175], [3000, 2.82842712],
  ])('holds %s px/s near %s percent for seconds without accumulating toward 8', (velocity, target) => {
    sustain(velocity, 5000, 10, 0);
    expect(lastBend()).toBeCloseTo(target, 5);
    expect(Math.max(...bends())).toBeLessThan(target * 1.01);
    const settled = bends().slice(20);
    expect(Math.min(...settled)).toBeGreaterThan(target * 0.99);
    expect(port.seek).not.toHaveBeenCalled();
  });

  it.each([6000, 9000])('a sustained %s px/s sweep approaches, but never exceeds, 8 percent', velocity => {
    sustain(velocity, 600);
    expect(lastBend()).toBeGreaterThan(7.99);
    expect(Math.max(...bends())).toBeLessThanOrEqual(8);
  });

  it.each([0, 0.00001, 1000, NaN])('an isolated 20px event is gentle even with elapsed=%s', elapsed => {
    jog.move(20, elapsed);
    vi.advanceTimersByTime(500);
    expect(Math.max(...bends())).toBeLessThan(0.05);
    expect(Math.max(...bends())).toBeGreaterThan(0);
    expect(lastBend()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([1, 5, 16, 20, 25, 50])('constant velocity is comparable with %sms event batching', batchMs => {
    sustain(1200, 3000, batchMs, 0);
    const settled = bends().slice(20);
    const average = settled.reduce((sum, bend) => sum + bend, 0) / settled.length;
    expect(average).toBeCloseTo(0.71554, 1);
    expect(lastBend()).toBeGreaterThan(0.6);
    expect(lastBend()).toBeLessThan(0.85);
  });

  it('uses a 50ms exponential response and reaches exactly zero at 500ms idle', () => {
    jog.move(600, 1);
    vi.advanceTimersByTime(25);
    expect(lastBend()).toBeCloseTo(8 * (1 - Math.exp(-0.5)), 10);
    vi.advanceTimersByTime(25);
    expect(lastBend()).toBeCloseTo(8 * (1 - Math.exp(-1)), 10);
    vi.advanceTimersByTime(425);
    expect(lastBend()).toBeGreaterThan(0);
    expect(lastBend()).toBeLessThan(0.01);
    vi.advanceTimersByTime(25);
    expect(lastBend()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const writes = bends().length;
    vi.advanceTimersByTime(5000);
    expect(bends()).toHaveLength(writes);
  });

  it('mirrors the entire response and follows reversal without unsigned accumulation', () => {
    sustain(1200, 1000);
    const forward = bends();
    jog.cancel();
    port.setBend.mockClear();
    sustain(-1200, 1000);
    expect(bends()).toEqual(forward.map(bend => -bend));
    sustain(1200, 300);
    expect(lastBend()).toBeGreaterThan(0.7);
  });

  it('zero motion does not keep an idle gesture alive; invalid deltas do not start one', () => {
    for (const dx of [0, NaN, Infinity, -Infinity]) jog.move(dx, 0);
    expect(vi.getTimerCount()).toBe(0);
    jog.move(20, 0);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(25);
      jog.move(0, 0);
    }
    expect(lastBend()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads live play state and preserves paused fine/coarse signed travel', () => {
    sustain(600, 100);
    port.state.playing = false;
    jog.move(1, 20);
    expect(lastBend()).toBe(0);
    expect(port.getPlayhead()).toBeCloseTo(60 + mouseSeekDelta(1, 20));
    jog.move(-200, 20);
    expect(port.getPlayhead()).toBeCloseTo(60 + mouseSeekDelta(1, 20) + mouseSeekDelta(-200, 20));
    expect(vi.getTimerCount()).toBe(0);
    port.state.playing = true;
    jog.move(20, 0);
    vi.advanceTimersByTime(100);
    expect(lastBend()).toBeLessThan(0.05);
    expect(port.seek).toHaveBeenCalledTimes(2);
  });

  it.each(['sync', 'timer'] as const)('a pause clears bend and pending motion via %s', via => {
    sustain(600, 100);
    port.state.playing = false;
    if (via === 'sync') jog.syncState();
    else vi.advanceTimersByTime(25);
    expect(lastBend()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    port.state.playing = true;
    vi.advanceTimersByTime(1000);
    expect(lastBend()).toBe(0);
  });

  it.each(['cancel', 'dispose', 'touch'] as const)('%s immediately discards applied bend and pending motion', action => {
    sustain(600, 100);
    jog.move(600, 0);
    if (action === 'touch') jog.setTouch(true);
    else jog[action]();
    expect(lastBend()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const writes = bends().length;
    vi.advanceTimersByTime(1000);
    expect(bends()).toHaveLength(writes);
  });

  it('cancels an unapplied packet without resetting another input bend', () => {
    jog.move(600, 0);
    jog.cancel();
    vi.advanceTimersByTime(1000);
    expect(port.setBend).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    jog.move(20, 0);
    vi.advanceTimersByTime(100);
    expect(lastBend()).toBeLessThan(0.05);
  });

  it.each([true, false])('arms without audio mutation, then holds actual scratch indefinitely, playing=%s', playing => {
    port.state.playing = playing;
    port.beginScratch.mockImplementation(() => {
      port.state.scratching = true;
      jog.syncState();
    });
    jog.setTouch(true);
    jog.setTouch(true);
    vi.advanceTimersByTime(10000);
    jog.syncState();
    for (const dx of [0, NaN, Infinity, -Infinity]) jog.move(dx, 10);
    expect(jog.isPlatterMode).toBe(true);
    expect(jog.isTouching).toBe(false);
    expect(port.state).toEqual({ playing, scratching: false, vinylMode: true });
    expect(port.beginScratch).not.toHaveBeenCalled();
    expect(port.endScratch).not.toHaveBeenCalled();
    expect(port.scratchMove).not.toHaveBeenCalled();
    expect(port.seek).not.toHaveBeenCalled();
    expect(port.setBend).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    jog.move(5, 10);
    vi.advanceTimersByTime(10000);
    expect(jog.isTouching).toBe(true);
    expect(jog.isPlatterMode).toBe(true);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    expect(port.endScratch).not.toHaveBeenCalled();
    expect(port.scratchMove.mock.calls).toEqual([[0.01, 0.01]]);
    expect(vi.getTimerCount()).toBe(0);
    jog.setTouch(false);
    jog.setTouch(false);
    expect(jog.isTouching).toBe(false);
    expect(jog.isPlatterMode).toBe(false);
    expect(port.endScratch.mock.calls).toEqual([[]]);
    expect(port.seek).not.toHaveBeenCalled();
    expect(port.setBend).not.toHaveBeenCalled();
    expect(port.state.playing).toBe(playing);
  });

  it.each([true, false])('delegates linear signed scratch and Slip release while playing=%s', playing => {
    port.state.playing = playing;
    jog.setTouch(true);
    expect(port.beginScratch).not.toHaveBeenCalled();
    expect(port.state.playing).toBe(playing);
    jog.move(500, 100);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    expect(port.scratchMove.mock.calls).toEqual([[1, 0.1]]);
    jog.move(-500, 1);
    jog.move(5, 0);
    jog.move(-5, 1000);
    expect(port.scratchMove.mock.calls).toEqual([[1, 0.1], [-1, 0.001], [0.01, 0.001], [-0.01, 0.1]]);
    jog.setTouch(false);
    // No release position override: the engine retains its Slip decision.
    expect(port.endScratch.mock.calls).toEqual([[]]);
    expect(port.seek).not.toHaveBeenCalled();
    expect(port.setBend).not.toHaveBeenCalled();
    expect(port.state.playing).toBe(playing);
  });

  it('Vinyl-off contact uses ordinary rim behavior and requires a fresh edge after mode-on', () => {
    port.state.vinylMode = false;
    jog.setTouch(true);
    expect(jog.isTouching).toBe(false);
    sustain(600, 500);
    expect(lastBend()).toBeCloseTo(0.25298, 4);
    port.state.playing = false;
    jog.move(20, 20);
    expect(port.seek).toHaveBeenCalledWith(60 + mouseSeekDelta(20, 20));
    port.state.vinylMode = true;
    jog.setTouch(true);
    expect(port.beginScratch).not.toHaveBeenCalled();
    jog.setTouch(false);
    jog.setTouch(true);
    jog.move(5, 10);
    expect(port.beginScratch).toHaveBeenCalledOnce();
  });

  it.each([true, false])('foreign scratching blocks contact and rim without touching foreign bend, playing=%s', playing => {
    port.state.playing = playing;
    port.state.scratching = true;
    jog.setTouch(true);
    jog.move(500, 10);
    jog.setTouch(false);
    jog.cancel();
    jog.dispose();
    vi.advanceTimersByTime(1000);
    expect(jog.isTouching).toBe(false);
    expect(port.beginScratch).not.toHaveBeenCalled();
    expect(port.scratchMove).not.toHaveBeenCalled();
    expect(port.endScratch).not.toHaveBeenCalled();
    expect(port.seek).not.toHaveBeenCalled();
    expect(port.setBend).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['sync', 'timer'] as const)('foreign scratch clears only our previous bend via %s, then receives no timer writes', via => {
    sustain(600, 100);
    port.state.scratching = true;
    if (via === 'sync') jog.syncState();
    else vi.advanceTimersByTime(25);
    expect(lastBend()).toBe(0);
    const writes = bends().length;
    jog.move(500, 10);
    vi.advanceTimersByTime(1000);
    expect(bends()).toHaveLength(writes);
    expect(vi.getTimerCount()).toBe(0);
    expect(port.scratchMove).not.toHaveBeenCalled();
  });

  it('rejected begin does not claim ownership or retry until a fresh contact', () => {
    port.beginScratch.mockImplementation(() => {});
    jog.setTouch(true);
    expect(jog.isTouching).toBe(false);
    jog.move(20, 10);
    jog.setTouch(true);
    jog.move(20, 10);
    expect(jog.isPlatterMode).toBe(false);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    jog.setTouch(false);
    expect(port.endScratch).not.toHaveBeenCalled();
    port.beginScratch.mockImplementation(() => { port.state.scratching = true; });
    jog.setTouch(true);
    jog.move(5, 10);
    expect(jog.isTouching).toBe(true);
  });

  it('synchronous begin cancellation cannot adopt a replacement scratch', () => {
    port.beginScratch.mockImplementation(() => {
      port.state.scratching = true;
      expect(jog.isTouching).toBe(true);
      jog.cancel();
      port.state.scratching = true; // Another owner starts during the notification.
    });
    jog.setTouch(true);
    jog.move(5, 10);
    expect(jog.isTouching).toBe(false);
    expect(port.endScratch).toHaveBeenCalledOnce();
    jog.move(20, 10);
    port.state.scratching = false;
    jog.setTouch(true);
    jog.move(20, 10);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    jog.setTouch(false);
    expect(port.endScratch).toHaveBeenCalledOnce();
    expect(port.scratchMove).not.toHaveBeenCalled();
  });

  it.each(['release', 'cancel', 'dispose'] as const)('%s clears ownership before synchronous end notification', action => {
    port.endScratch.mockImplementation(() => {
      expect(jog.isTouching).toBe(false);
      jog.cancel();
      port.state.scratching = false;
      jog.syncState();
    });
    jog.setTouch(true);
    jog.move(5, 10);
    if (action === 'release') jog.setTouch(false);
    else jog[action]();
    expect(port.endScratch).toHaveBeenCalledOnce();
    expect(jog.isTouching).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('engine-ended scratch drops ownership and cannot restart from a remaining contact', () => {
    jog.setTouch(true);
    jog.move(5, 10);
    port.scratchMove.mockClear();
    port.state.scratching = false;
    jog.syncState();
    expect(jog.isTouching).toBe(false);
    jog.setTouch(true);
    jog.move(20, 10);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    expect(port.scratchMove).not.toHaveBeenCalled();
    port.state.scratching = true;
    jog.cancel();
    jog.setTouch(false);
    expect(port.endScratch).not.toHaveBeenCalled();
    port.state.scratching = false;
    jog.setTouch(true);
    jog.move(5, 10);
    expect(port.beginScratch).toHaveBeenCalledTimes(2);
  });

  it.each(['cancel', 'vinyl-off', 'foreign'] as const)('%s invalidates arming until physical release', action => {
    jog.setTouch(true);
    if (action === 'cancel') jog.cancel();
    if (action === 'vinyl-off') port.state.vinylMode = false;
    if (action === 'foreign') port.state.scratching = true;
    jog.syncState();
    expect(jog.isPlatterMode).toBe(false);
    expect(jog.isTouching).toBe(false);
    expect(port.endScratch).not.toHaveBeenCalled();
    port.state.vinylMode = true;
    port.state.scratching = false;
    jog.setTouch(true);
    jog.move(20, 10);
    expect(port.beginScratch).not.toHaveBeenCalled();
    jog.setTouch(false);
    jog.setTouch(true);
    expect(jog.isPlatterMode).toBe(true);
    expect(port.beginScratch).not.toHaveBeenCalled();
    jog.move(20, 10);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    expect(port.scratchMove).toHaveBeenCalledWith(0.04, 0.01);
  });

  it('foreign scratch refused at contact cannot be acquired when the foreign hold ends', () => {
    port.state.scratching = true;
    jog.setTouch(true);
    port.state.scratching = false;
    jog.setTouch(true);
    jog.move(20, 10);
    expect(jog.isPlatterMode).toBe(false);
    expect(port.beginScratch).not.toHaveBeenCalled();
    jog.setTouch(false);
    jog.setTouch(true);
    jog.move(20, 10);
    expect(port.beginScratch).toHaveBeenCalledOnce();
  });

  it.each([true, false])('release before motion returns to rim without an engine release, playing=%s', playing => {
    port.state.playing = playing;
    jog.setTouch(true);
    jog.setTouch(false);
    expect(jog.isPlatterMode).toBe(false);
    jog.move(20, 10);
    vi.advanceTimersByTime(25);
    expect(port.beginScratch).not.toHaveBeenCalled();
    expect(port.endScratch).not.toHaveBeenCalled();
    if (playing) expect(lastBend()).toBeGreaterThan(0);
    else expect(port.seek).toHaveBeenCalledWith(60 + mouseSeekDelta(20, 10));
  });

  it.each([true, false])('releasing actual scratch returns remaining mouse input to rim, playing=%s', playing => {
    port.state.playing = playing;
    jog.setTouch(true);
    jog.move(20, 10);
    jog.setTouch(false);
    jog.move(20, 10);
    vi.advanceTimersByTime(25);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    expect(port.endScratch).toHaveBeenCalledOnce();
    expect(port.scratchMove).toHaveBeenCalledOnce();
    expect(jog.isPlatterMode).toBe(false);
    if (playing) expect(lastBend()).toBeGreaterThan(0);
    else expect(port.seek).toHaveBeenCalledWith(60 + mouseSeekDelta(20, 10));
  });

  it('cancel requires release before recontact, and dispose permanently ignores new input', () => {
    jog.setTouch(true);
    jog.move(5, 10);
    jog.cancel();
    jog.setTouch(true);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    jog.setTouch(false);
    jog.setTouch(true);
    jog.move(5, 10);
    expect(port.beginScratch).toHaveBeenCalledTimes(2);
    jog.dispose();
    jog.setTouch(false);
    jog.setTouch(true);
    jog.move(600, 1);
    vi.advanceTimersByTime(1000);
    expect(port.beginScratch).toHaveBeenCalledTimes(2);
    expect(port.endScratch).toHaveBeenCalledTimes(2);
    expect(port.setBend).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads sensitivity and acceleration live during sustained motion without resetting the filter', () => {
    let settings = { ...DEFAULT_MOUSE_JOG_SETTINGS, sensitivity: 1 };
    const tuning = vi.fn(() => settings);
    jog = new MouseJogController(port, tuning);
    sustain(1200, 1000, 5);
    const before = lastBend();
    settings = { ...settings, sensitivity: 2 };
    sustain(1200, 25, 5);
    expect(lastBend()).toBeCloseTo(before + (1 - Math.exp(-0.5)) * (mouseJogBendTarget(1200, settings) - before), 10);
    sustain(1200, 1000, 5);
    expect(lastBend()).toBeCloseTo(mouseJogBendTarget(1200, settings), 5);
    settings = { ...settings, acceleration: 1 };
    sustain(1200, 1000, 5);
    expect(lastBend()).toBeCloseTo(3.2, 5);
    expect(bends()).not.toContain(0);
    expect(vi.getTimerCount()).toBe(1);
    expect(tuning).toHaveBeenCalledTimes(121);
  });

  it('changes smoothing on the next tick using elapsed tick time and the existing bend', () => {
    let settings = { ...DEFAULT_MOUSE_JOG_SETTINGS };
    jog = new MouseJogController(port, () => settings);
    jog.move(600, 1);
    vi.advanceTimersByTime(25);
    const before = lastBend();
    settings = { ...settings, smoothingMs: 200 };
    vi.advanceTimersByTime(25);
    expect(lastBend()).toBeCloseTo(before + (1 - Math.exp(-25 / 200)) * (8 - before), 10);
    settings = { ...settings, smoothingMs: 0 };
    vi.advanceTimersByTime(25);
    expect(lastBend()).toBe(8);
  });

  it.each([0, 200])('keeps acceleration extremes finite and bounded with smoothing=%s', smoothingMs => {
    let settings = { ...DEFAULT_MOUSE_JOG_SETTINGS, smoothingMs, sensitivity: 4, acceleration: 1 };
    jog = new MouseJogController(port, () => settings);
    sustain(1200, 3000);
    expect(lastBend()).toBeCloseTo(mouseJogBendTarget(1200, settings), 4);
    settings = { ...settings, acceleration: 3 };
    sustain(-1200, 3000);
    expect(lastBend()).toBeCloseTo(mouseJogBendTarget(-1200, settings), 4);
    sustain(1e6, 3000);
    sustain(-1e6, 3000);
    expect(bends().every(bend => Number.isFinite(bend) && Math.abs(bend) <= 8)).toBe(true);
  });

  it('lets maximum smoothing decay past 500ms and stops exactly at 1700ms idle', () => {
    jog = new MouseJogController(port, () => ({ ...DEFAULT_MOUSE_JOG_SETTINGS, smoothingMs: 200 }));
    jog.move(600, 1);
    vi.advanceTimersByTime(500);
    expect(lastBend()).toBeGreaterThan(0.1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1175);
    expect(lastBend()).toBeGreaterThan(0);
    expect(lastBend()).toBeLessThan(0.01);
    vi.advanceTimersByTime(25);
    expect(lastBend()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('zero smoothing applies immediately and stops at 100ms idle', () => {
    jog = new MouseJogController(port, () => ({ ...DEFAULT_MOUSE_JOG_SETTINGS, smoothingMs: 0 }));
    jog.move(-600, 1);
    vi.advanceTimersByTime(25);
    expect(lastBend()).toBe(-8);
    vi.advanceTimersByTime(75);
    expect(lastBend()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes signed window velocity and reads settings only on filter ticks', () => {
    const tuning = vi.fn(() => DEFAULT_MOUSE_JOG_SETTINGS);
    const onSpeed = vi.fn();
    jog = new MouseJogController(port, tuning, onSpeed);
    jog.move(60, 0);
    jog.move(-20, 1000);
    jog.syncState();
    expect(tuning).not.toHaveBeenCalled();
    expect(onSpeed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(25);
    expect(onSpeed.mock.calls).toEqual([[400]]);
    expect(lastBend()).toBeCloseTo(mouseJogBendTarget(400, DEFAULT_MOUSE_JOG_SETTINGS) * (1 - Math.exp(-0.5)), 10);
    jog.move(-80, 0);
    vi.advanceTimersByTime(25);
    expect(onSpeed.mock.calls).toEqual([[400], [-400]]);
    vi.advanceTimersByTime(75);
    expect(onSpeed).toHaveBeenLastCalledWith(-800);
    vi.advanceTimersByTime(25);
    expect(onSpeed).toHaveBeenLastCalledWith(0);
    vi.advanceTimersByTime(375);
    expect(tuning).toHaveBeenCalledTimes(21);
    expect(vi.getTimerCount()).toBe(0);
    const publishes = onSpeed.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(tuning).toHaveBeenCalledTimes(21);
    expect(onSpeed).toHaveBeenCalledTimes(publishes);
  });

  it.each(['cancel', 'pause', 'scratch', 'touch', 'dispose'] as const)('%s clears telemetry with no timer or publication leaks', action => {
    const tuning = vi.fn(() => DEFAULT_MOUSE_JOG_SETTINGS);
    const onSpeed = vi.fn();
    jog = new MouseJogController(port, tuning, onSpeed);
    sustain(-600, 100);
    expect(onSpeed).toHaveBeenLastCalledWith(-600);
    if (action === 'pause') port.state.playing = false;
    else if (action === 'scratch') port.state.scratching = true;
    else if (action === 'touch') jog.setTouch(true);
    else jog[action]();
    jog.syncState();
    expect(onSpeed).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
    tuning.mockClear();
    onSpeed.mockClear();
    vi.advanceTimersByTime(5000);
    jog.syncState();
    expect(tuning).not.toHaveBeenCalled();
    expect(onSpeed).not.toHaveBeenCalled();
  });

  it('paused seek and armed/owned scratch neither read tuning nor publish speed', () => {
    const tuning = vi.fn(() => DEFAULT_MOUSE_JOG_SETTINGS);
    const onSpeed = vi.fn();
    jog = new MouseJogController(port, tuning, onSpeed);
    port.state.playing = false;
    jog.move(20, 10);
    jog.setTouch(true);
    vi.advanceTimersByTime(1000);
    jog.move(-20, 10);
    vi.advanceTimersByTime(1000);
    jog.setTouch(false);
    expect(tuning).not.toHaveBeenCalled();
    expect(onSpeed).not.toHaveBeenCalled();
    expect(port.seek).toHaveBeenCalledWith(60 + mouseSeekDelta(20, 10));
    expect(port.scratchMove).toHaveBeenCalledWith(-0.04, 0.01);
  });

  it('synchronous telemetry cancellation cannot write a stale bend or leak its timer', () => {
    const onSpeed = vi.fn((speed: number) => {
      if (speed !== 0) jog.cancel();
    });
    jog = new MouseJogController(port, undefined, onSpeed);
    jog.move(600, 1);
    vi.advanceTimersByTime(25);
    expect(onSpeed.mock.calls).toEqual([[6000], [0]]);
    expect(port.setBend).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(onSpeed).toHaveBeenCalledTimes(2);
  });
});
