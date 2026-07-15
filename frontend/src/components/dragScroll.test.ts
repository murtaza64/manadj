import { describe, expect, it } from 'vitest';
import { DRAG_EDGE_MAX_STEP_PX, DRAG_EDGE_ZONE_PX, dragEdgeScrollDelta } from './dragScroll';

describe('dragEdgeScrollDelta (playlist drag-reorder edge auto-scroll)', () => {
  const TOP = 100;
  const BOTTOM = 500;

  it('is inert in the middle of the pane', () => {
    expect(dragEdgeScrollDelta(300, TOP, BOTTOM)).toBe(0);
    expect(dragEdgeScrollDelta(TOP + DRAG_EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
    expect(dragEdgeScrollDelta(BOTTOM - DRAG_EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
  });

  it('scrolls up near the top edge, ramping toward max at the edge', () => {
    const nearEdge = dragEdgeScrollDelta(TOP + 1, TOP, BOTTOM);
    const nearZone = dragEdgeScrollDelta(TOP + DRAG_EDGE_ZONE_PX - 1, TOP, BOTTOM);
    expect(nearEdge).toBeLessThan(0);
    expect(nearZone).toBeLessThan(0);
    expect(nearEdge).toBeLessThan(nearZone); // faster at the edge
    expect(dragEdgeScrollDelta(TOP, TOP, BOTTOM)).toBe(-DRAG_EDGE_MAX_STEP_PX);
  });

  it('scrolls down near the bottom edge, mirrored', () => {
    expect(dragEdgeScrollDelta(BOTTOM, TOP, BOTTOM)).toBe(DRAG_EDGE_MAX_STEP_PX);
    expect(dragEdgeScrollDelta(BOTTOM - 10, TOP, BOTTOM)).toBeGreaterThan(0);
  });

  it('clamps outside the pane to the max step (pointer overshoot)', () => {
    expect(dragEdgeScrollDelta(TOP - 50, TOP, BOTTOM)).toBe(-DRAG_EDGE_MAX_STEP_PX);
    expect(dragEdgeScrollDelta(BOTTOM + 50, TOP, BOTTOM)).toBe(DRAG_EDGE_MAX_STEP_PX);
  });
});
