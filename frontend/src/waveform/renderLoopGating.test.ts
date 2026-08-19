/**
 * Render-loop gating (performance-hardening 01): the self-driven loop's
 * scheduling — 60fps only while playing/moving/dirty, 250ms idle poll when
 * paused and unchanged, full sleep while the owning view is hidden, and
 * instant wake on mutation. GL is irrelevant here: instances are built via
 * Object.create with renderFrame stubbed, so only the scheduling seam runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaveformRendererV2 } from './WaveformRendererV2';
import type { PlaybackClock } from '../playback/clock';

type LoopHarness = {
  renderer: WaveformRendererV2;
  renders: () => number;
  /** Run pending rAF callbacks (one frame). */
  frame: () => void;
  clock: PlaybackClock & { playhead: number };
};

function makeHarness(): LoopHarness {
  let renderCount = 0;
  const clock = {
    playhead: 0,
    getPlayhead() {
      return this.playhead;
    },
  };
  const renderer: WaveformRendererV2 = Object.create(WaveformRendererV2.prototype);
  // The private fields the loop reads, minus any GL state.
  Object.assign(renderer as unknown as Record<string, unknown>, {
    lastPlayhead: 0,
    animationFrame: null,
    idleTimer: null,
    dirty: true,
    active: true,
    playing: false,
    clock: null,
    scheduledTick: null,
    // canvasResized() reads these; a stable size means "no resize".
    canvas: { width: 0, height: 0, clientWidth: 0, clientHeight: 0 },
  });
  vi.spyOn(renderer, 'renderFrame').mockImplementation((c: PlaybackClock) => {
    renderCount++;
    // renderFrame's real contract: records the playhead it drew.
    (renderer as unknown as { lastPlayhead: number }).lastPlayhead = c.getPlayhead();
  });
  return {
    renderer,
    renders: () => renderCount,
    frame: () => {
      // Fire only rAF callbacks (16ms < IDLE_TICK_MS, so idle timers hold).
      vi.advanceTimersByTime(16);
    },
    clock,
  };
}

describe('WaveformRendererV2 render-loop gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    });
    // Node test env: the loop reaches window only for setTimeout/clearTimeout.
    vi.stubGlobal('window', {
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('drops to the idle poll when paused and unchanged, drawing nothing', () => {
    const h = makeHarness();
    h.renderer.startRenderLoop(h.clock);
    expect(h.renders()).toBe(1); // first frame renders immediately
    // The dirty render schedules one bonus rAF frame (cascades), which
    // finds nothing to draw; then: idle polls only CHECK, zero renders.
    h.frame();
    h.frame();
    vi.advanceTimersByTime(1000);
    expect(h.renders()).toBe(1);
  });

  it('the idle poll catches a paused playhead jump within one cadence', () => {
    const h = makeHarness();
    h.renderer.startRenderLoop(h.clock);
    h.frame(); // settle into idle
    const before = h.renders();
    h.clock.playhead = 42; // e.g. an external seek nobody marked dirty for
    vi.advanceTimersByTime(300);
    expect(h.renders()).toBe(before + 1);
  });

  it('stays at rAF cadence while the playhead moves', () => {
    const h = makeHarness();
    h.renderer.startRenderLoop(h.clock);
    const before = h.renders();
    for (let i = 0; i < 5; i++) {
      h.clock.playhead += 0.016;
      h.frame();
    }
    expect(h.renders()).toBe(before + 5);
  });

  it('stays at rAF cadence while setPlaying(true), even with a still playhead', () => {
    const h = makeHarness();
    h.renderer.startRenderLoop(h.clock);
    h.renderer.setPlaying(true);
    const before = h.renders();
    h.frame();
    h.frame();
    expect(h.renders()).toBe(before + 2);
  });

  it('markDirty wakes an idle-parked loop on the next frame, not the next poll', () => {
    const h = makeHarness();
    h.renderer.startRenderLoop(h.clock);
    h.frame(); // settle into idle (paused, unchanged)
    const before = h.renders();
    h.renderer.setCuePoint(12); // any mutator: markDirty
    h.frame(); // one frame-length, far below the 250ms poll
    expect(h.renders()).toBe(before + 1);
  });

  it('setActive(false) sleeps entirely; setActive(true) repaints immediately', () => {
    const h = makeHarness();
    h.renderer.startRenderLoop(h.clock);
    h.renderer.setActive(false);
    const before = h.renders();
    // Nothing schedules while hidden — not even the idle poll.
    vi.advanceTimersByTime(2000);
    expect(h.renders()).toBe(before);
    // Mutations while hidden don't schedule either.
    h.renderer.setCuePoint(3);
    vi.advanceTimersByTime(2000);
    expect(h.renders()).toBe(before);
    // Re-activation renders a fresh frame synchronously (no stale flash).
    h.renderer.setActive(true);
    expect(h.renders()).toBe(before + 1);
  });

  it('stopRenderLoop cancels both schedules', () => {
    const h = makeHarness();
    h.renderer.startRenderLoop(h.clock);
    h.renderer.stopRenderLoop();
    const before = h.renders();
    vi.advanceTimersByTime(2000);
    expect(h.renders()).toBe(before);
  });
});
