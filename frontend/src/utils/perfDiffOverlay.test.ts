import { describe, expect, it } from 'vitest';

import {
  beatMarkersFromTempoChanges,
  markersInWindow,
  panWindow,
  zoomWindow,
} from './perfDiffOverlay';

const change = (start_time: number, bpm: number, bar_position = 1) => ({
  start_time,
  bpm,
  bar_position,
});

describe('beatMarkersFromTempoChanges', () => {
  it('expands a constant grid across the duration', () => {
    // 120 BPM = 0.5s per beat; 10s from 0.0 -> 20 beats
    const markers = beatMarkersFromTempoChanges([change(0, 120)], 10);
    expect(markers).toHaveLength(20);
    expect(markers[0]).toEqual({ time: 0, isDownbeat: true });
    expect(markers[1].time).toBeCloseTo(0.5);
    expect(markers.filter((m) => m.isDownbeat)).toHaveLength(5);
  });

  it('anchors downbeats by bar_position', () => {
    // first beat is bar position 4 -> next beat is the downbeat
    const markers = beatMarkersFromTempoChanges([change(0, 120, 4)], 2);
    expect(markers.map((m) => m.isDownbeat)).toEqual([false, true, false, false]);
  });

  it('uses the full tempo-change list, not just the first', () => {
    // 60 BPM for 4s (4 beats), then 120 BPM for 2s (4 beats)
    const markers = beatMarkersFromTempoChanges(
      [change(0, 60), change(4, 120)],
      6,
    );
    expect(markers).toHaveLength(8);
    expect(markers[3].time).toBeCloseTo(3);
    expect(markers[4].time).toBeCloseTo(4); // second segment starts exactly at its change
    expect(markers[5].time).toBeCloseTo(4.5); // and steps at the NEW tempo
  });

  it('segment beats never overrun the next tempo change', () => {
    // 60 BPM segment would put beats at 0,1,2,...; change at 2.3 cuts it off
    const markers = beatMarkersFromTempoChanges(
      [change(0, 60), change(2.3, 120)],
      3,
    );
    const firstSegment = markers.filter((m) => m.time < 2.3);
    expect(firstSegment.map((m) => m.time)).toEqual([0, 1, 2]);
  });

  it('offset grids start at their start_time', () => {
    const markers = beatMarkersFromTempoChanges([change(0.35, 128)], 2);
    expect(markers[0].time).toBeCloseTo(0.35);
  });

  it('ignores non-positive BPM and empty inputs', () => {
    expect(beatMarkersFromTempoChanges([], 10)).toEqual([]);
    expect(beatMarkersFromTempoChanges([change(0, 0)], 10)).toEqual([]);
    expect(beatMarkersFromTempoChanges([change(0, 120)], 0)).toEqual([]);
  });
});

describe('window helpers', () => {
  const markers = beatMarkersFromTempoChanges([change(0, 120)], 100);

  it('markersInWindow returns only visible markers', () => {
    const visible = markersInWindow(markers, 10, 2);
    expect(visible.every((m) => m.time >= 10 && m.time < 12)).toBe(true);
    expect(visible).toHaveLength(4);
  });

  it('zoomWindow keeps the anchor time at the same fraction', () => {
    const z = zoomWindow(10, 20, 15, 0.5, 100);
    expect(z.windowSeconds).toBe(10);
    // anchor was at 25% of the window; still is
    expect((15 - z.windowStart) / z.windowSeconds).toBeCloseTo(0.25);
  });

  it('zoomWindow clamps to track bounds and min zoom', () => {
    const z = zoomWindow(90, 20, 100, 2, 100);
    expect(z.windowStart + z.windowSeconds).toBeLessThanOrEqual(100);
    const tight = zoomWindow(0, 1, 0.5, 0.01, 100, 0.5);
    expect(tight.windowSeconds).toBe(0.5);
  });

  it('panWindow clamps to track bounds', () => {
    expect(panWindow(0, 10, -5, 100)).toBe(0);
    expect(panWindow(85, 10, 20, 100)).toBe(90);
  });
});
