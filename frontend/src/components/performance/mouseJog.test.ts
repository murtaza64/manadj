import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mouseSeekDelta } from './mouseControl';
import { MouseJogController } from './mouseJog';
import type { MouseJogPort } from './mouseJog';

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
    jog = new MouseJogController(port);
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

  it('holds stationary contact indefinitely and releases through the engine only', () => {
    port.beginScratch.mockImplementation(() => {
      port.state.scratching = true;
      jog.syncState();
    });
    jog.setTouch(true);
    jog.setTouch(true);
    vi.advanceTimersByTime(10000);
    expect(jog.isTouching).toBe(true);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    expect(port.endScratch).not.toHaveBeenCalled();
    expect(port.scratchMove).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    jog.setTouch(false);
    jog.setTouch(false);
    expect(jog.isTouching).toBe(false);
    expect(port.endScratch.mock.calls).toEqual([[]]);
    expect(port.seek).not.toHaveBeenCalled();
    expect(port.setBend).not.toHaveBeenCalled();
    expect(port.state.playing).toBe(true);
  });

  it.each([true, false])('delegates linear signed scratch and Slip release while playing=%s', playing => {
    port.state.playing = playing;
    jog.setTouch(true);
    jog.move(500, 100);
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
    expect(port.beginScratch).toHaveBeenCalledOnce();
    jog.setTouch(false);
    expect(port.endScratch).not.toHaveBeenCalled();
    port.beginScratch.mockImplementation(() => { port.state.scratching = true; });
    jog.setTouch(true);
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
    expect(jog.isTouching).toBe(false);
    expect(port.endScratch).toHaveBeenCalledOnce();
    jog.move(20, 10);
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
    if (action === 'release') jog.setTouch(false);
    else jog[action]();
    expect(port.endScratch).toHaveBeenCalledOnce();
    expect(jog.isTouching).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('engine-ended scratch drops ownership and cannot restart from a remaining contact', () => {
    jog.setTouch(true);
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
    expect(port.beginScratch).toHaveBeenCalledTimes(2);
  });

  it('cancel requires release before recontact, and dispose permanently ignores new input', () => {
    jog.setTouch(true);
    jog.cancel();
    jog.setTouch(true);
    expect(port.beginScratch).toHaveBeenCalledOnce();
    jog.setTouch(false);
    jog.setTouch(true);
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
});
