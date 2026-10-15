import { afterEach, describe, expect, it } from 'vitest';
import { setVisualWallClock, visualContextTime } from './visualClock';

const QUANTUM = 128 / 44100;

/** A context whose currentTime advances in whole render quanta, delivered
 * in bursts of 1-4 quanta like the real audio thread callback. */
function steppedContext() {
  const ctx = { currentTime: 0, state: 'running' as string };
  let wall = 0;
  let offset = 0;
  setVisualWallClock(() => wall);
  return {
    ctx,
    jump(seconds: number) {
      offset += seconds;
    },
    /** Advance wall time; currentTime catches up to the last whole burst. */
    advance(seconds: number, burst = 4) {
      wall += seconds;
      const step = QUANTUM * burst;
      ctx.currentTime = offset + Math.floor(wall / step) * step;
    },
  };
}

afterEach(() => setVisualWallClock(null));

describe('visualContextTime', () => {
  it('advances evenly per frame where currentTime staircases', () => {
    const { ctx, advance } = steppedContext();
    const frame = 1 / 120;
    const rawSteps: number[] = [];
    const visSteps: number[] = [];
    let prevRaw = ctx.currentTime;
    let prevVis = visualContextTime(ctx);
    for (let i = 0; i < 600; i++) {
      advance(frame);
      const vis = visualContextTime(ctx);
      if (i > 120) {
        rawSteps.push(Math.abs(ctx.currentTime - prevRaw - frame));
        visSteps.push(Math.abs(vis - prevVis - frame));
      }
      prevRaw = ctx.currentTime;
      prevVis = vis;
    }
    const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    expect(p50(rawSteps)).toBeGreaterThan(0.002);
    expect(p50(visSteps)).toBeLessThan(0.0005);
    // Stays close to the audio clock.
    expect(Math.abs(prevVis - ctx.currentTime)).toBeLessThan(QUANTUM * 4);
  });

  it('never runs backwards while running', () => {
    const { ctx, advance } = steppedContext();
    let prev = visualContextTime(ctx);
    for (let i = 0; i < 300; i++) {
      advance(1 / 120 + (i % 7) * 0.001);
      const v = visualContextTime(ctx);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('several reads in one frame agree', () => {
    const { ctx, advance } = steppedContext();
    visualContextTime(ctx);
    advance(1 / 120);
    const a = visualContextTime(ctx);
    expect(visualContextTime(ctx)).toBe(a);
  });

  it('snaps on a discontinuity and passes through when not running', () => {
    const { ctx, advance, jump } = steppedContext();
    visualContextTime(ctx);
    advance(1 / 120);
    visualContextTime(ctx);
    jump(1); // e.g. a resumed context jumped ahead
    advance(1 / 120);
    expect(visualContextTime(ctx)).toBe(ctx.currentTime);
    ctx.state = 'suspended';
    advance(1 / 120);
    expect(visualContextTime(ctx)).toBe(ctx.currentTime);
  });
});
