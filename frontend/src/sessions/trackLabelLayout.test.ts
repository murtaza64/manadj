import { expect, it } from 'vitest';
import { buildTimeAxis, deriveTimeline } from './timelineModel';
import { layoutTrackLabels } from './trackLabelLayout';

const model = deriveTimeline([{ t: 0, kind: 'tick', playheads: {} }, { t: 500, kind: 'tick', playheads: {} }]);
const axis = buildTimeAxis(model, { pxPerSec: 1, collapseIdle: false, thresholdS: 45 });
const spans = [0, 100, 120, 140, 240].map((start, index, starts) => ({
  start, end: starts[index + 1] ?? 500, trackId: index + 1,
}));
const names = Object.fromEntries(spans.map(sp => [sp.trackId, `Track ${sp.trackId} with a long title`]));

it('keeps every crowded load, with non-overlapping labels and exact load anchors', () => {
  const labels = layoutTrackLabels(spans, axis, names, 0, 500);
  expect(labels).toHaveLength(spans.length);
  expect(labels.map(label => label.markerX)).toEqual(spans.map(sp => sp.start));
  expect(labels.every(label => label.shown.length >= 3)).toBe(true);
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (labels[i].row === labels[j].row) {
        expect(labels[i].x + labels[i].width).toBeLessThanOrEqual(labels[j].x);
      }
    }
  }
});

it('keeps the current title onscreen while scrolling, without inventing a new load', () => {
  const labels = layoutTrackLabels(spans, axis, names, 190, 200);
  const current = labels.find(label => label.index === 3)!;
  expect(current.x).toBe(196);
  expect(current.markerX).toBe(140);
  expect(current.shown.length).toBeGreaterThan(0);
  expect(labels.some(label => label.index === 0)).toBe(false);
});

it('retains repeated and very dense loads as hoverable markers, within the available rows', () => {
  const dense = Array.from({ length: 30 }, (_, index) => ({ start: index, end: index + 1, trackId: 1 }));
  const labels = layoutTrackLabels(dense, axis, names, 0, 500, 2);
  expect(labels).toHaveLength(30);
  expect(labels.every(label => label.label === names[1] && label.row < 2)).toBe(true);
  expect(new Set(labels.map(label => label.index)).size).toBe(30);
});

it('keeps loads inside a collapsed gap rather than dropping all but the last', () => {
  const collapsed = buildTimeAxis(model, { pxPerSec: 1, collapseIdle: true, thresholdS: 45 });
  const labels = layoutTrackLabels(spans, collapsed, names, 0, 500);
  expect(labels).toHaveLength(spans.length);
  expect(labels.every(label => label.label.length > 0)).toBe(true);
});
