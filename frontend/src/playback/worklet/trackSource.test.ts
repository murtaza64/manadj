import { describe, expect, it } from 'vitest';
import { SingleTrackSource, StemTrackSource } from './trackSource';

function ramp(n: number, scale = 1): Float32Array {
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = (i + 1) * scale;
  return data;
}

describe('SingleTrackSource', () => {
  it('reads samples with mono upmix and zero-pads out of range', () => {
    const source = new SingleTrackSource([ramp(4)]);
    expect(source.sampleAt(0, 2)).toBe(3);
    expect(source.sampleAt(1, 2)).toBe(3); // mono upmix
    expect(source.sampleAt(0, -1)).toBe(0);
    expect(source.sampleAt(0, 4)).toBe(0);
  });

  it('maps stereo channels independently', () => {
    const source = new SingleTrackSource([ramp(4), ramp(4, 10)]);
    expect(source.sampleAt(0, 1)).toBe(2);
    expect(source.sampleAt(1, 1)).toBe(20);
  });
});

describe('StemTrackSource', () => {
  /** Two mono "stems": values 1..n and 10..10n. */
  function stems(n = 8): StemTrackSource {
    return new StemTrackSource([[ramp(n)], [ramp(n, 10)]]);
  }

  it('sums stems at unity gains (the replace-policy identity)', () => {
    const source = stems();
    expect(source.sampleAt(0, 3)).toBe(4 + 40);
    expect(source.length).toBe(8);
  });

  it('a killed stem vanishes from reads', () => {
    const source = stems();
    source.setGain(1, 0, 0, 1);
    expect(source.sampleAt(0, 3)).toBe(4);
  });

  it('gain ramps interpolate over the ramp window in track frames', () => {
    const source = stems();
    source.setGain(0, 0, 2, 4); // 1 -> 0 over frames 2..6
    expect(source.gainAt(0, 2)).toBe(1);
    expect(source.gainAt(0, 4)).toBeCloseTo(0.5);
    expect(source.gainAt(0, 6)).toBe(0);
    expect(source.gainAt(0, 1)).toBe(1); // before the anchor: old gain
  });

  it('re-anchoring mid-ramp starts from the current effective gain', () => {
    const source = stems();
    source.setGain(0, 0, 0, 4);
    source.setGain(0, 1, 2, 4); // flip back halfway down
    expect(source.gainAt(0, 2)).toBeCloseTo(0.5);
    expect(source.gainAt(0, 6)).toBe(1);
  });

  it('fillWindow matches per-sample reads (bulk path, constant gains)', () => {
    const source = stems();
    source.setGain(1, 0.5, 0, 1);
    const dest = new Float32Array(6);
    source.fillWindow(dest, 0, 1);
    for (let i = 0; i < 6; i++) {
      expect(dest[i]).toBeCloseTo(source.sampleAt(0, 1 + i), 5);
    }
  });

  it('fillWindow matches per-sample reads while a ramp intersects', () => {
    const source = stems();
    source.setGain(0, 0, 3, 4); // ramp inside the window
    const dest = new Float32Array(8);
    source.fillWindow(dest, 0, 0);
    for (let i = 0; i < 8; i++) {
      expect(dest[i]).toBeCloseTo(source.sampleAt(0, i), 5);
    }
  });

  it('fillWindow zero-pads outside the track', () => {
    const source = stems(4);
    const dest = new Float32Array(8).fill(9);
    source.fillWindow(dest, 0, -2);
    expect(dest[0]).toBe(0);
    expect(dest[1]).toBe(0);
    expect(dest[2]).toBeCloseTo(1 + 10);
    expect(dest[6]).toBe(0);
    expect(dest[7]).toBe(0);
  });

  it('upmixes mono stems and clamps mixed channel counts', () => {
    const stereoStem = [ramp(4), ramp(4, 100)];
    const monoStem = [ramp(4, 10)];
    const source = new StemTrackSource([stereoStem, monoStem]);
    expect(source.sampleAt(0, 0)).toBe(1 + 10);
    expect(source.sampleAt(1, 0)).toBe(100 + 10); // mono stem upmixed to R
  });
});
