// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createWaveformViewport } from './waveformViewport';

afterEach(() => vi.restoreAllMocks());

it('reuses panned pixels, redraws at the margin, and invalidates scale and size', () => {
  const raster = { setTransform: vi.fn(), clearRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(raster as unknown as CanvasRenderingContext2D);
  const target = document.createElement('canvas');
  const draw = vi.fn();
  const paint = createWaveformViewport(draw);
  paint(target, 0, 10, 1000, 150, 2);
  expect(draw).toHaveBeenCalledTimes(1);
  paint(target, 100, 10, 1000, 150, 2);
  paint(target, -100, 10, 1000, 150, 2);
  expect(draw).toHaveBeenCalledTimes(2);
  paint(target, 601, 10, 1000, 150, 2);
  expect(draw).toHaveBeenCalledTimes(3);
  paint(target, 600, 11, 1000, 150, 2);
  paint(target, 600, 11, 1000, 180, 2);
  paint(target, 600, 11, 1100, 180, 2);
  paint(target, 600, 11, 1100, 180, 1.5);
  expect(draw).toHaveBeenCalledTimes(7);
  expect(target.style.transform).toMatch(/^translateX\(/);
});

it('does not interpolate cached pixels at fractional DPR or allocate a whole-track bitmap', () => {
  const raster = { setTransform: vi.fn(), clearRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(raster as unknown as CanvasRenderingContext2D);
  const target = document.createElement('canvas');
  const draw = vi.fn();
  const paint = createWaveformViewport(draw);
  paint(target, 100000, 256, 1600, 100, 1.5);
  paint(target, 100002, 256, 1600, 100, 1.5);
  paint(target, 100004, 256, 1600, 100, 1.5);
  expect(draw).toHaveBeenCalledTimes(2);
  expect(target.style.transform).toBe('translateX(-802px)');
  paint(target, 100003, 256, 1600, 100, 1.5);
  expect(draw).toHaveBeenCalledTimes(3);
  expect(target.width).toBe(4800);
  expect(target.style.transform).toBe('translateX(-800px)');
  paint(target, 100003, 256, 1001, 100, 1.5);
  expect(parseFloat(target.style.width) * 1.5).toBeCloseTo(target.width, 10);
  const paints = draw.mock.calls.length;
  paint(target, 100005, 256, 1001, 100, 1.5);
  expect(draw).toHaveBeenCalledTimes(paints);
});
