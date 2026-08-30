/** Stem waveform compositing (stems #213): quantization round-trip and
 * combination math against hand-built MWF1-shaped arrays. */
import { describe, expect, it } from 'vitest';
import { compositeStemWaveforms } from './blob';
import type { ParsedWaveformArrays, WaveformBlobHeader } from './blob';

const GAMMA = 0.5;

function header(peakCount: number, bandCount: number): WaveformBlobHeader {
  return {
    version: 2,
    sampleRate: 44100,
    duration: 1,
    peakHop: 128,
    bandHop: 512,
    stftWindow: 2048,
    nBands: 8,
    gamma: GAMMA,
    bandEdges: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    peakCount,
    bandCount,
  };
}

/** Quantize a linear amplitude the way the backend does. */
const q = (amp: number) => Math.round(Math.min(1, amp) ** GAMMA * 255);

function stem(peakAmps: number[], bandAmp: number): ParsedWaveformArrays {
  const peaks = new Uint8Array(peakAmps.map(q));
  const bands = new Uint8Array(peakAmps.length * 8).fill(q(bandAmp));
  return { header: header(peakAmps.length, peakAmps.length), peaks, bands };
}

/** Dequantize one value from a LOD pack's level-0 slice. */
const deq = (v: number) => (v / 255) ** (1 / GAMMA);

describe('compositeStemWaveforms', () => {
  it('a single active stem round-trips its own values', () => {
    const s = stem([0.5, 0.25, 1], 0.3);
    const out = compositeStemWaveforms([s, stem([0.9, 0.9, 0.9], 0.9)], [true, false]);
    // Level 0 of the peaks pack holds the composite's frame values.
    for (let f = 0; f < 3; f++) {
      expect(out.peaks.data[out.peaks.levelOffsets[0] + f]).toBe(s.peaks[f]);
    }
  });

  it('peaks combine as a clamped linear sum', () => {
    const out = compositeStemWaveforms(
      [stem([0.3], 0), stem([0.4], 0), stem([0.9], 0)],
      [true, true, true]
    );
    const v = out.peaks.data[out.peaks.levelOffsets[0]];
    expect(deq(v)).toBeCloseTo(1, 2); // 0.3+0.4+0.9 clamps to 1
  });

  it('bands combine as a power sum (sqrt of squares)', () => {
    const out = compositeStemWaveforms(
      [stem([0], 0.3), stem([0], 0.4)],
      [true, true]
    );
    const v = out.bandsLo.data[out.bandsLo.levelOffsets[0]];
    expect(deq(v)).toBeCloseTo(Math.sqrt(0.3 ** 2 + 0.4 ** 2), 2);
  });

  it('no active stems composites to silence', () => {
    const out = compositeStemWaveforms([stem([0.5], 0.5)], [false]);
    expect(out.peaks.data[out.peaks.levelOffsets[0]]).toBe(0);
  });

  it('uses the min frame count across stems', () => {
    const out = compositeStemWaveforms(
      [stem([0.5, 0.5], 0.1), stem([0.5], 0.1)],
      [true, true]
    );
    expect(out.header.peakCount).toBe(1);
  });
});
