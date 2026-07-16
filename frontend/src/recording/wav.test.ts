import { describe, expect, it } from 'vitest';
import { encodeFloatWav } from './wav';

describe('float WAV encoder', () => {
  it('writes a stereo IEEE-float RIFF header and interleaved samples', async () => {
    const blob = encodeFloatWav([new Float32Array([0.25, -0.5, 1, -1])], 48000);
    const view = new DataView(await blob.arrayBuffer());
    const text = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(view.buffer, offset, length));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(16);
    expect(view.getFloat32(44, true)).toBeCloseTo(0.25);
    expect(view.getFloat32(56, true)).toBeCloseTo(-1);
  });
});
