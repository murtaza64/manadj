// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { appendPoint, compositeScreenshot, normalizePoint, PEN_WIDTH, type Stroke } from './annotate';

describe('normalizePoint', () => {
  it('maps client coordinates into the 0..1 frame and clamps outside', () => {
    const bounds = new DOMRect(100, 50, 200, 100);
    expect(normalizePoint(200, 100, bounds)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizePoint(0, 0, bounds)).toEqual({ x: 0, y: 0 });
    expect(normalizePoint(500, 500, bounds)).toEqual({ x: 1, y: 1 });
  });
});

describe('appendPoint', () => {
  it('drops sub-pixel duplicates and caps stroke length', () => {
    let points: Stroke['points'] = [{ x: 0.5, y: 0.5 }];
    points = appendPoint(points, { x: 0.5005, y: 0.5005 });
    expect(points).toHaveLength(1);
    points = appendPoint(points, { x: 0.6, y: 0.6 });
    expect(points).toHaveLength(2);
    let many: Stroke['points'] = [];
    for (let i = 0; i < 500; i++) many = appendPoint(many, { x: i / 1000, y: 0.5 });
    expect(many.length).toBeLessThanOrEqual(400);
  });
});

describe('compositeScreenshot', () => {
  it('returns the base image untouched when there is nothing to bake', async () => {
    const base = 'data:image/png;base64,aGVsbG8=';
    await expect(compositeScreenshot(base, [], null)).resolves.toBe(base);
  });
});

describe('stroke shape', () => {
  it('uses normalized width for baked pixels', () => {
    expect(PEN_WIDTH).toBeLessThan(0.02);
    const stroke: Stroke = { color: '#f9e2af', width: PEN_WIDTH, points: [{ x: 0, y: 0 }] };
    expect(stroke.points[0]).toEqual({ x: 0, y: 0 });
  });
});
