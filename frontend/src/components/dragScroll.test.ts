import { describe, expect, it } from 'vitest';
import {
  DRAG_EDGE_MAX_ELAPSED_MS,
  DRAG_EDGE_MAX_SPEED_PX_PER_S,
  DRAG_EDGE_ZONE_PX,
  dragEdgeScrollDelta,
} from './dragScroll';

describe('dragEdgeScrollDelta (playlist drag-reorder edge auto-scroll)', () => {
  const TOP = 100;
  const BOTTOM = 500;
  const DT = 16; // ~60 Hz dragover cadence

  it('is inert in the middle of the pane', () => {
    expect(dragEdgeScrollDelta(300, TOP, BOTTOM, DT)).toBe(0);
    expect(dragEdgeScrollDelta(TOP + DRAG_EDGE_ZONE_PX, TOP, BOTTOM, DT)).toBe(0);
    expect(dragEdgeScrollDelta(BOTTOM - DRAG_EDGE_ZONE_PX, TOP, BOTTOM, DT)).toBe(0);
  });

  it('scrolls up near the top edge, ramping toward max speed at the edge', () => {
    const nearEdge = dragEdgeScrollDelta(TOP + 1, TOP, BOTTOM, DT);
    const nearZone = dragEdgeScrollDelta(TOP + DRAG_EDGE_ZONE_PX - 1, TOP, BOTTOM, DT);
    expect(nearEdge).toBeLessThan(0);
    expect(nearZone).toBeLessThan(0);
    expect(nearEdge).toBeLessThan(nearZone); // faster at the edge
    expect(dragEdgeScrollDelta(TOP, TOP, BOTTOM, DT)).toBeCloseTo(
      -DRAG_EDGE_MAX_SPEED_PX_PER_S * (DT / 1000),
      9
    );
  });

  it('scrolls down near the bottom edge, mirrored', () => {
    expect(dragEdgeScrollDelta(BOTTOM, TOP, BOTTOM, DT)).toBeCloseTo(
      DRAG_EDGE_MAX_SPEED_PX_PER_S * (DT / 1000),
      9
    );
    expect(dragEdgeScrollDelta(BOTTOM - 10, TOP, BOTTOM, DT)).toBeGreaterThan(0);
  });

  it('speed is time-normalized: double the elapsed time, double the delta', () => {
    const one = dragEdgeScrollDelta(TOP, TOP, BOTTOM, 10);
    const two = dragEdgeScrollDelta(TOP, TOP, BOTTOM, 20);
    expect(two).toBeCloseTo(one * 2, 9);
  });

  it('caps stationary-refire gaps so they cannot jump', () => {
    const capped = dragEdgeScrollDelta(TOP, TOP, BOTTOM, 350);
    expect(capped).toBeCloseTo(
      -DRAG_EDGE_MAX_SPEED_PX_PER_S * (DRAG_EDGE_MAX_ELAPSED_MS / 1000),
      9
    );
    expect(dragEdgeScrollDelta(TOP, TOP, BOTTOM, -5)).toBe(-0);
  });

  it('clamps pointer overshoot beyond the pane to edge speed', () => {
    expect(dragEdgeScrollDelta(TOP - 50, TOP, BOTTOM, DT)).toBeCloseTo(
      -DRAG_EDGE_MAX_SPEED_PX_PER_S * (DT / 1000),
      9
    );
    expect(dragEdgeScrollDelta(BOTTOM + 50, TOP, BOTTOM, DT)).toBeCloseTo(
      DRAG_EDGE_MAX_SPEED_PX_PER_S * (DT / 1000),
      9
    );
  });
});
