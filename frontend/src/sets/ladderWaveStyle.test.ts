// CPU style port tests (sets 30): the ladder's 2D interpretation of the
// Waveform style slots must track the shader's math — grouping/RMS, soft
// limit, master, displayGamma, and each style's color logic.

import { describe, expect, it } from 'vitest';
import type { DecodedWaveform } from '../waveform/blob';
import { buildLodPack } from '../waveform/blob';
import { DEFAULT_PARAMS, STYLE_REGISTRY, type StyleParams } from '../waveform/styles';
import { computeStyledColumns, PAINTABLE_STYLE_IDS } from './ladderWaveStyle';

const SR = 44100;
const PEAK_HOP = 128;
const BAND_HOP = 512;

/** Synthetic blob: every band frame = `bandQ` (per-band quantized bytes),
 * every peak = `peakQ`. */
function makeWaveform(frames: number, bandQ: number[], peakQ = 255): DecodedWaveform {
  const duration = (frames * BAND_HOP) / SR;
  const peakCount = Math.ceil((duration * SR) / PEAK_HOP);
  const peaks = new Uint8Array(peakCount).fill(peakQ);
  const lo = new Uint8Array(frames * 4);
  const hi = new Uint8Array(frames * 4);
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 4; k++) {
      lo[f * 4 + k] = bandQ[k];
      hi[f * 4 + k] = bandQ[4 + k];
    }
  }
  return {
    header: {
      version: 2,
      sampleRate: SR,
      duration,
      peakHop: PEAK_HOP,
      bandHop: BAND_HOP,
      stftWindow: 2048,
      nBands: 8,
      gamma: 0.5,
      bandEdges: [20, 60, 150, 400, 1000, 2500, 6000, 12000, 20000],
      peakCount,
      bandCount: frames,
    },
    peaks: buildLodPack(peaks, peakCount, 1, 'max'),
    bandsLo: buildLodPack(lo, frames, 4, 'mean'),
    bandsHi: buildLodPack(hi, frames, 4, 'mean'),
    duration,
  };
}

const params = (patch: Partial<StyleParams> = {}): StyleParams => ({
  ...DEFAULT_PARAMS,
  ...patch,
});

const parseCss = (css: string): [number, number, number] => {
  const m = css.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  if (!m) throw new Error(`bad css: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

describe('registry coverage', () => {
  it('paints every style in the registry', () => {
    for (const s of STYLE_REGISTRY) {
      expect(PAINTABLE_STYLE_IDS).toContain(s.id);
    }
  });
});

describe('computeStyledColumns', () => {
  // Constant signal: all 8 bands quantized at 128. With gamma 0.5 and
  // displayGamma 1, amp = (128/255)^2; groups (b1=3, b2=5) hold 3/2/3
  // bands. Gains chosen to keep every group below the 0.6 soft knee,
  // where softLimit is exactly identity.
  const a = (128 / 255) ** 2;
  const e = a * a;
  const p = params({ gains: [1, 0.5, 0.25], master: 1, smooth: false });
  const gLow = Math.sqrt(3 * e) * 1;
  const gMid = Math.sqrt(2 * e) * 0.5;
  const gHigh = Math.sqrt(3 * e) * 0.25;
  const wave = makeWaveform(200, [128, 128, 128, 128, 128, 128, 128, 128]);

  it('additive-rgb: segment heights follow the shader group math', () => {
    const cols = computeStyledColumns(wave, 'additive-rgb', p, 0.3, 0.9, 40);
    const segs = cols[20].segments;
    expect(segs).toHaveLength(3);
    // Cut heights = sorted group heights.
    expect(segs[0].y1).toBeCloseTo(gHigh, 5);
    expect(segs[1].y1).toBeCloseTo(gMid, 5);
    expect(segs[2].y1).toBeCloseTo(gLow, 5);
    // Bottom segment: all three groups active — additive default colors
    // [1,.1,.1]+[0,1,.25]+[.2,.45,1] + BG, clamped to 1 => white.
    expect(parseCss(segs[0].css)).toEqual([255, 255, 255]);
    // Top segment: low group only => BG + [1, .1, .1] clamped.
    const top = parseCss(segs[2].css);
    expect(top[0]).toBe(255);
    expect(top[1]).toBe(Math.round((0.03 + 0.1) * 255));
    expect(top[2]).toBe(Math.round((0.05 + 0.1) * 255));
  });

  it('applies master to group heights', () => {
    const doubled = computeStyledColumns(
      wave,
      'additive-rgb',
      params({ gains: [1, 0.5, 0.25], master: 2, smooth: false }),
      0.3,
      0.9,
      10,
    );
    // master 2 doubles post-limit heights (still < 1 here).
    expect(doubled[5].segments[2].y1).toBeCloseTo(gLow * 2, 5);
  });

  it('layered-opaque: gray peak silhouette above the tallest group', () => {
    const cols = computeStyledColumns(wave, 'layered-opaque', p, 0.3, 0.9, 10);
    const segs = cols[5].segments;
    // Peaks are full-scale (255): silhouette to 1.0, gray above gLow.
    const topSeg = segs[segs.length - 1];
    expect(topSeg.y1).toBeCloseTo(1, 5);
    expect(parseCss(topSeg.css)).toEqual([
      Math.round(0.15 * 255),
      Math.round(0.15 * 255),
      Math.round(0.2 * 255),
    ]);
    // Opaque layering, last write wins: bottom segment (all groups
    // active) is the HIGH color (default white)…
    expect(parseCss(segs[0].css)).toEqual([255, 255, 255]);
    // …and between gMid and gLow only the low group paints (default blue).
    expect(segs[2].y1).toBeCloseTo(gLow, 5);
    expect(parseCss(segs[2].css)).toEqual([
      Math.round(0.08 * 255),
      Math.round(0.22 * 255),
      Math.round(1.0 * 255),
    ]);
  });

  it('honors params.colors overrides', () => {
    const cols = computeStyledColumns(
      wave,
      'additive-rgb',
      params({
        gains: [1, 0, 0],
        master: 1,
        smooth: false,
        colors: [
          [0, 0.5, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      }),
      0.3,
      0.9,
      10,
    );
    const segs = cols[5].segments;
    expect(segs).toHaveLength(1);
    const rgb = parseCss(segs[0].css);
    expect(rgb[1]).toBe(Math.round((0.03 + 0.5) * 255));
  });

  it('brightness dims toward BG', () => {
    const full = computeStyledColumns(wave, 'additive-rgb', p, 0.3, 0.9, 10, 1);
    const dim = computeStyledColumns(wave, 'additive-rgb', p, 0.3, 0.9, 10, 0.5);
    const fullRgb = parseCss(full[5].segments[2].css);
    const dimRgb = parseCss(dim[5].segments[2].css);
    // BG + (c - BG) * 0.5, per channel.
    for (let k = 0; k < 3; k++) {
      const bg = [0.03, 0.03, 0.05][k] * 255;
      expect(Math.abs(dimRgb[k] - (bg + (fullRgb[k] - bg) * 0.5))).toBeLessThanOrEqual(1);
    }
  });

  it('marks out-of-track columns', () => {
    const cols = computeStyledColumns(wave, 'additive-rgb', p, -0.5, 0.5, 10);
    expect(cols[0].outOfTrack).toBe(true);
    expect(cols[9].outOfTrack).toBe(false);
  });

  it('silent signal yields no segments', () => {
    const silent = makeWaveform(200, [0, 0, 0, 0, 0, 0, 0, 0], 0);
    const cols = computeStyledColumns(silent, 'additive-rgb', p, 0.3, 0.9, 10);
    expect(cols[5].segments).toHaveLength(0);
  });

  it('every registry style renders without throwing and stays in-range', () => {
    for (const s of STYLE_REGISTRY) {
      const cols = computeStyledColumns(wave, s.id, params(), 0.3, 0.9, 24);
      for (const col of cols) {
        for (const seg of col.segments) {
          expect(seg.y1).toBeGreaterThan(seg.y0);
          expect(seg.y1).toBeLessThanOrEqual(1);
          expect(() => parseCss(seg.css)).not.toThrow();
        }
      }
    }
  });
});
