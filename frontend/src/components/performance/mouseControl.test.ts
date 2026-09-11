import { describe, expect, it } from 'vitest';
import { invertControl, KNOB_STROKE_PAUSE_MS, MIXER_DRAG_RANGE_PX, mouseJogTicks, moveKnob } from './mouseControl';

describe.each([false, true])('knob stroke (bipolar=%s)', (bipolar) => {
  const center = bipolar ? 0 : 0.5;
  const range = bipolar ? 2 : 1;
  const pixel = 1 / MIXER_DRAG_RANGE_PX;

  it.each([-1, 1])('captures entry and large overshoots from side %s', (sign) => {
    for (const delta of [0.02, 0.04, 0.1, 10]) {
      const gesture = moveKnob(undefined, center + sign * 0.04 * range, -sign * delta, 0, bipolar);
      expect(gesture.value).toBe(center);
      expect(gesture.notch).toBe('stopped');
    }
  });

  it.each([-1, 1])('holds through continuous micro-moves, sweeps and reversals from side %s', (sign) => {
    let gesture = moveKnob(undefined, center + sign * 0.04 * range, -sign * 0.03, 0, bipolar);
    for (let now = 16; now <= 640; now += 16) {
      gesture = moveKnob(gesture, gesture.value, -sign * pixel, now, bipolar);
      expect(gesture.value).toBe(center);
    }
    for (const delta of [-sign * 10, sign * 10]) {
      gesture = moveKnob(gesture, gesture.value, delta, gesture.lastMotion + 159, bipolar);
      expect(gesture.value).toBe(center);
    }
  });

  it.each([-1, 1])('releases after the pause, departs in 1px steps, then recaptures on return (%s)', (sign) => {
    let gesture = moveKnob(undefined, center + 0.04 * range, -0.03, 0, bipolar);
    gesture = moveKnob(gesture, gesture.value, sign * pixel, 159, bipolar);
    expect(gesture.value).toBe(center);
    gesture = moveKnob(gesture, gesture.value, 0, 300, bipolar);
    expect(gesture.lastMotion).toBe(159);
    gesture = moveKnob(gesture, gesture.value, sign * pixel, 159 + KNOB_STROKE_PAUSE_MS, bipolar);
    expect(gesture.value).toBeCloseTo(center + sign * pixel * range);
    for (let i = 2; i <= 8; i++) {
      gesture = moveKnob(gesture, gesture.value, sign * pixel, gesture.lastMotion + 16, bipolar);
      expect(gesture.value).toBeCloseTo(center + sign * i * pixel * range);
    }
    expect(gesture.notch).toBe('armed');
    gesture = moveKnob(gesture, gesture.value, -sign * pixel, gesture.lastMotion + 16, bipolar);
    expect(gesture.value).toBe(center);
    expect(gesture.notch).toBe('stopped');
  });

  it.each([-1, 1])('lets a new hold depart center in 1px steps (%s)', (sign) => {
    let gesture = moveKnob(undefined, center, sign * pixel, 0, bipolar);
    for (let i = 2; i <= 10; i++) {
      gesture = moveKnob(gesture, gesture.value, sign * pixel, i * 16, bipolar);
      expect(gesture.value).toBeCloseTo(center + sign * i * pixel * range);
    }
  });

  it('resets the latch/baseline on external changes or a new hold', () => {
    const stopped = moveKnob(undefined, center + 0.04 * range, -0.03, 0, bipolar);
    const external = center - 0.01 * range;
    const moved = moveKnob(stopped, external, -pixel, 16, bipolar);
    expect(moved.value).toBeCloseTo(external - pixel * range);
    expect(moveKnob(moved, center, pixel, 32, bipolar).value).toBeCloseTo(center + pixel * range);
    expect(moveKnob(undefined, stopped.value, pixel, 16, bipolar).value).toBeCloseTo(center + pixel * range);
  });

  it('clamps at an endpoint without accumulating overshoot', () => {
    const top = moveKnob(undefined, center, 10, 0, bipolar);
    expect(top.value).toBe(1);
    expect(moveKnob(top, top.value, -pixel, 16, bipolar).value).toBeCloseTo(1 - pixel * range);
    const bottom = moveKnob(undefined, center, -10, 0, bipolar);
    expect(bottom.value).toBe(bipolar ? -1 : 0);
    expect(moveKnob(bottom, bottom.value, pixel, 16, bipolar).value).toBeCloseTo(bottom.value + pixel * range);
  });
});

describe('mouse jog response', () => {
  it('keeps slow movement gentle, with bounded acceleration for fast sweeps', () => {
    expect(mouseJogTicks(1, 20)).toBeCloseTo(0.05);
    const medium = mouseJogTicks(5, 20) / 5;
    expect(medium).toBeGreaterThan(0.05);
    expect(medium).toBeLessThan(0.15);
    expect(mouseJogTicks(20, 20)).toBeCloseTo(3);
    expect(mouseJogTicks(200, 20)).toBeCloseTo(30);
    // Even the accelerated response stays below the old 0.2 ticks/px.
    expect(mouseJogTicks(200, 20)).toBeLessThan(200 / 5);
  });

  it('is symmetric and independent of event batching at the same speed', () => {
    expect(mouseJogTicks(-5, 20)).toBeCloseTo(-mouseJogTicks(5, 20));
    expect(mouseJogTicks(10, 40)).toBeCloseTo(mouseJogTicks(5, 20) * 2);
    expect(mouseJogTicks(0, 0)).toBe(0);
    expect(Number.isFinite(mouseJogTicks(1, 0))).toBe(true);
  });
});

it.each([
  [0, 0.5, 0.5], [0.03, 0.5, 0.5], [0.47, 0.5, 0], [0.5, 0.5, 0], [1, 0.5, 0],
  [0, 1, 1], [0.05, 1, 1], [0.94, 1, 0], [1, 1, 0],
])('inverts %s around off/on=%s to %s', (value, on, expected) => {
  expect(invertControl(value, on)).toBe(expected);
});
