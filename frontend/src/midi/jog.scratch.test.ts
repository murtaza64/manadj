import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JogController, JOG_RELEASE_IDLE_MS } from './jog';
import { GRV6_JOG_CALIBRATION as calibration } from './jogCalibration';

describe('GRV6 scratch controller', () => {
  let active: boolean;
  let vinyl: boolean;
  let playing: boolean;
  let jog: JogController;
  const begin = vi.fn();
  const move = vi.fn();
  const end = vi.fn();
  const seek = vi.fn();
  const bend = vi.fn();
  const rate = vi.fn(() => 0);
  const touchTicks = (ticks: number) => jog.onTouchTicks(ticks, undefined, calibration, 'grv6');
  const rimTicks = (ticks: number, off = false) => jog.onTicks(ticks, undefined, calibration, 'grv6', off);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    active = false;
    vinyl = true;
    playing = true;
    rate.mockReturnValue(0);
    begin.mockImplementation(() => { active = true; });
    end.mockImplementation(() => { active = false; });
    jog = new JogController({
      isPlaying: () => playing,
      getPlayhead: () => 60,
      seek,
      setBend: bend,
      scratch: {
        isActive: () => active,
        vinylMode: () => vinyl,
        begin,
        move,
        rate,
        end,
      },
    });
  });

  afterEach(() => {
    jog.dispose();
    vi.useRealTimers();
  });

  it('holds a stationary platter indefinitely and releases immediately without motion', () => {
    jog.onTouch(true);
    vi.advanceTimersByTime(10_000);
    expect(begin).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    jog.onTouch(false);
    expect(end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])('does not adopt or disturb another input scratch while playing=%s', running => {
    playing = running;
    active = true;
    jog.onTouch(true);
    touchTicks(30);
    rimTicks(30);
    jog.onTouchTicks(30); // Legacy touch streams must not seek through it either.
    jog.onTouch(false);
    jog.dispose();
    vi.advanceTimersByTime(1000);
    expect(begin).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
    expect(bend).not.toHaveBeenCalled();
    expect(active).toBe(true);
  });

  it('clears its old bend when another input takes the platter', () => {
    rimTicks(30);
    vi.advanceTimersByTime(25);
    expect(bend.mock.lastCall?.[0]).toBeGreaterThan(0);
    active = true;
    jog.syncState();
    expect(bend).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(end).not.toHaveBeenCalled();
  });

  it.each([true, false])('sends signed calibrated displacement while playing=%s', (running) => {
    playing = running;
    jog.onTouch(true);
    vi.advanceTimersByTime(7);
    touchTicks(-40);
    vi.advanceTimersByTime(12);
    touchTicks(20);
    expect(move.mock.calls).toEqual([
      [-40 * calibration.touchSeekSecondsPerTick, 0.007],
      [20 * calibration.touchSeekSecondsPerTick, 0.012],
    ]);
    expect(seek).not.toHaveBeenCalled();
    expect(bend).not.toHaveBeenCalled();
  });

  it('clamps motion durations to 1-30ms without inventing motion on idle', () => {
    jog.onTouch(true);
    touchTicks(10);
    vi.advanceTimersByTime(1_000);
    touchTicks(-10);
    expect(move.mock.calls.map((call) => call[1])).toEqual([0.001, 0.03]);
    vi.advanceTimersByTime(10_000);
    expect(move).toHaveBeenCalledTimes(2);
    expect(end).not.toHaveBeenCalled();
  });

  it('keeps a recognized reverse throw in the same scratch until fresh rim ticks stop', () => {
    jog.onTouch(true);
    vi.advanceTimersByTime(10);
    touchTicks(-63);
    rate.mockReturnValue(-3);
    jog.onTouch(false);
    expect(end).not.toHaveBeenCalled();
    expect(active).toBe(true);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(5);
      rimTicks(-20);
      expect(active).toBe(true);
    }
    expect(move).toHaveBeenCalledTimes(5);
    expect(begin).toHaveBeenCalledOnce();
    expect(bend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(JOG_RELEASE_IDLE_MS - 1);
    expect(end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    rimTicks(20);
    vi.advanceTimersByTime(25);
    expect(bend).toHaveBeenCalled();
  });

  it('keeps a forward throw through the threshold-gated touch-to-rim handoff', () => {
    jog.onTouch(true, 0);
    touchTicks(63);
    rate.mockReturnValue(3);
    jog.onTouch(false, 1);

    vi.advanceTimersByTime(20);
    rimTicks(20);

    expect(active).toBe(true);
    expect(end).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledTimes(2);
  });

  it('releases promptly after motion stopped while still touching', () => {
    jog.onTouch(true);
    touchTicks(-20);
    vi.advanceTimersByTime(100);
    jog.onTouch(false);
    expect(end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([-2, -1, 4])('release above the fresh-motion threshold ends despite residual rate %sx', speed => {
    jog.onTouch(true);
    touchTicks(-63);
    rate.mockReturnValue(speed);
    vi.advanceTimersByTime(25);
    jog.onTouch(false);
    expect(end).toHaveBeenCalledOnce();
    rimTicks(-20);
    expect(begin).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('engine override cancels a physical coast without touching a new gesture', () => {
    jog.onTouch(true);
    touchTicks(-63);
    rate.mockReturnValue(-3);
    jog.onTouch(false);
    vi.advanceTimersByTime(5);
    rimTicks(-20);
    active = false;
    jog.syncState();
    active = true;
    vi.advanceTimersByTime(1_000);
    expect(end).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retouch cancels the release timeout without restarting the gesture or relatching Slip', () => {
    jog.onTouch(true);
    touchTicks(-20);
    rate.mockReturnValue(-3);
    jog.onTouch(false);
    vi.advanceTimersByTime(5);
    rimTicks(-20);
    vi.advanceTimersByTime(5);
    jog.onTouch(true);
    vi.advanceTimersByTime(1_000);
    expect(begin).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
    jog.onTouch(false);
    expect(end).toHaveBeenCalledOnce();
  });

  it('ends a recognized throw after the release window if no rim tick follows hand-up', () => {
    jog.onTouch(true);
    touchTicks(-60);
    rate.mockReturnValue(-3);
    jog.onTouch(false);
    vi.advanceTimersByTime(JOG_RELEASE_IDLE_MS - 1);
    expect(end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(end).toHaveBeenCalledOnce();
    rimTicks(-60);
    expect(begin).toHaveBeenCalledOnce();
    expect(move).toHaveBeenCalledOnce();
  });

  it('does not coast a reverse rate whose last real movement is 24ms old', () => {
    jog.onTouch(true);
    touchTicks(-60);
    rate.mockReturnValue(-3);
    vi.advanceTimersByTime(24);
    jog.onTouch(false);
    expect(end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['cancel', 'shift', 'override', 'timer'] as const)('%s clears coast and rim suppression', via => {
    jog.onTouch(true);
    touchTicks(-60);
    rate.mockReturnValue(-3);
    jog.onTouch(false);
    if (via === 'cancel') jog.cancel();
    if (via === 'shift') jog.onSeekTicks(1, undefined, calibration);
    if (via === 'override' || via === 'timer') {
      active = false;
      if (via === 'override') jog.syncState();
      else vi.advanceTimersByTime(JOG_RELEASE_IDLE_MS);
    }
    rimTicks(-20);
    vi.advanceTimersByTime(25);
    expect(bend).toHaveBeenCalled();
    expect(begin).toHaveBeenCalledOnce();
  });

  it('software Vinyl-off ignores contact and treats the touch stream as ordinary rim nudging', () => {
    vinyl = false;
    jog.onTouch(true);
    touchTicks(20);
    vi.advanceTimersByTime(25);
    expect(begin).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(bend).toHaveBeenCalledWith(0.5);
    jog.cancel();
    playing = false;
    touchTicks(20);
    expect(seek).toHaveBeenCalledWith(60 + 20 * calibration.rimSeekSecondsPerTick);
  });

  it('hardware Vinyl-off stream overrides stale contact without resetting every nudge packet', () => {
    jog.onTouch(true);
    touchTicks(-20);
    rimTicks(20, true);
    rimTicks(20, true);
    vi.advanceTimersByTime(25);
    expect(end).toHaveBeenCalledOnce();
    expect(bend).toHaveBeenCalledWith(1);
    jog.onTouch(false);
    expect(end).toHaveBeenCalledOnce();
  });

  it('shift seek cancels scratching and its release timer', () => {
    jog.onTouch(true);
    touchTicks(-20);
    jog.onTouch(false);
    jog.onSeekTicks(2, undefined, calibration);
    expect(end).toHaveBeenCalledOnce();
    expect(seek).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(end).toHaveBeenCalledOnce();
  });

  it.each(['sync', 'tick', 'timer'] as const)('invalidates an engine-overridden hold via %s without ending a replacement', (via) => {
    jog.onTouch(true);
    touchTicks(-20);
    if (via === 'timer') {
      rate.mockReturnValue(-3);
      jog.onTouch(false);
      vi.advanceTimersByTime(5);
      rimTicks(-20);
      end.mockClear();
      move.mockClear();
      touchTicks(-20); // Touch stream while released: coast continues it.
    }
    active = false; // Engine load/pause/manual seek already ended this scratch.
    if (via === 'sync') jog.syncState();
    if (via === 'tick') touchTicks(20);
    if (via === 'timer') vi.advanceTimersByTime(100);
    expect(end).not.toHaveBeenCalled();
    if (via === 'tick') expect(move).toHaveBeenCalledTimes(2); // override + held re-acquire
    else expect(move).toHaveBeenCalledOnce();
    active = true; // A later gesture must not be ended by an old timer.
    vi.advanceTimersByTime(1_000);
    expect(end).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dispose clears both scratch release and bend timers', () => {
    rimTicks(20);
    vi.advanceTimersByTime(25);
    jog.onTouch(true);
    expect(bend).toHaveBeenLastCalledWith(0);
    touchTicks(-20);
    jog.onTouch(false);
    jog.dispose();
    expect(end).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never starts a scratch from rotation alone and drops unsupported touch capability', () => {
    touchTicks(20);
    expect(begin).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
    const legacy = new JogController({ isPlaying: () => false, getPlayhead: () => 60, seek, setBend: bend });
    legacy.onTouch(true);
    legacy.onTouch(false);
    expect(seek).not.toHaveBeenCalled();
    legacy.onTouchTicks(2);
    expect(seek).toHaveBeenCalledWith(60.02);
    legacy.dispose();
  });
});
