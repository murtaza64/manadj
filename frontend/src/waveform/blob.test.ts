// Decoder + LOD pyramid tests against the backend-generated golden blob
// (frontend/src/waveform/fixtures/golden.wfb — a 2s 1.5kHz -6dBFS tone,
// regenerate via backend.waveform_data.generate_blob). Locks the format
// agreement between backend writer and frontend reader (ADR 0014).

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLodPack, decodeWaveformBlob, LEVEL_FACTOR, TEX_WIDTH } from './blob';

const golden = () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const buf = readFileSync(join(dir, 'fixtures', 'golden.wfb'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

describe('decodeWaveformBlob (golden blob)', () => {
  it('decodes the header the backend wrote', () => {
    const d = decodeWaveformBlob(golden());
    expect(d.header.version).toBe(2);
    expect(d.header.sampleRate).toBe(44100);
    expect(d.header.peakHop).toBe(128);
    expect(d.header.bandHop).toBe(512);
    expect(d.header.stftWindow).toBe(2048);
    expect(d.header.nBands).toBe(8);
    expect(d.header.gamma).toBeCloseTo(0.5);
    expect(d.header.bandEdges).toHaveLength(9);
    expect(d.header.bandEdges[0]).toBeCloseTo(20);
    expect(d.header.bandEdges[8]).toBeCloseTo(20000);
    expect(d.duration).toBeCloseTo(2.0, 1);
  });

  it('sizes arrays per the duration/hop arithmetic', () => {
    const d = decodeWaveformBlob(golden());
    const samples = d.header.duration * d.header.sampleRate;
    expect(d.peaks.levelCounts[0]).toBeCloseTo(samples / d.header.peakHop, -1);
    expect(d.bandsLo.levelCounts[0]).toBe(d.header.bandCount);
    expect(d.bandsHi.levelCounts[0]).toBe(d.header.bandCount);
  });

  it('puts the 1.5kHz tone in band 4 (1-2.5kHz), quiet neighbors', () => {
    const d = decodeWaveformBlob(golden());
    const frames = d.header.bandCount;
    // Band 4 lives in bandsHi channel 0 (bands 4-7 -> RGBA).
    let band4 = 0;
    let band3 = 0; // bandsLo channel 3
    for (let f = Math.floor(frames / 4); f < Math.floor((3 * frames) / 4); f++) {
      band4 += d.bandsHi.data[f * 4];
      band3 += d.bandsLo.data[f * 4 + 3];
    }
    expect(band4).toBeGreaterThan(band3 * 2);
    expect(band4 / frames).toBeGreaterThan(50); // sustained, not incidental
  });

  it('rejects bad magic and unsupported versions', () => {
    const buf = golden();
    const bad = buf.slice(0);
    new DataView(bad).setUint8(0, 88); // 'X'
    expect(() => decodeWaveformBlob(bad)).toThrow(/magic/);
    const v99 = buf.slice(0);
    new DataView(v99).setUint16(4, 99, true);
    expect(() => decodeWaveformBlob(v99)).toThrow(/version/);
  });

  it('rejects truncated blobs', () => {
    expect(() => decodeWaveformBlob(golden().slice(0, 64))).toThrow(/truncated|magic/);
  });
});

describe('buildLodPack (ADR 0015 aggregation invariants)', () => {
  it('peaks aggregate with max — a lone spike survives every level', () => {
    const base = new Uint8Array(TEX_WIDTH * LEVEL_FACTOR * 2); // 2 levels above base
    base[12345] = 255;
    const pack = buildLodPack(base, base.length, 1, 'max');
    expect(pack.numLevels).toBeGreaterThan(1);
    for (let level = 1; level < pack.numLevels; level++) {
      const idx = Math.floor(12345 / LEVEL_FACTOR ** level);
      expect(pack.data[pack.levelOffsets[level] + idx]).toBe(255);
    }
  });

  it('bands aggregate with mean — a lone spike dilutes per level', () => {
    const count = TEX_WIDTH * LEVEL_FACTOR;
    const base = new Uint8Array(count * 4);
    base[1000 * 4] = 200; // one frame, channel 0
    const pack = buildLodPack(base, count, 4, 'mean');
    const idx = Math.floor(1000 / LEVEL_FACTOR);
    expect(pack.data[(pack.levelOffsets[1] + idx) * 4]).toBe(Math.round(200 / LEVEL_FACTOR));
  });

  it('packs level offsets contiguously within the tiled texture', () => {
    const count = TEX_WIDTH * LEVEL_FACTOR * 2;
    const pack = buildLodPack(new Uint8Array(count), count, 1, 'max');
    for (let k = 1; k < pack.numLevels; k++) {
      expect(pack.levelOffsets[k]).toBe(pack.levelOffsets[k - 1] + pack.levelCounts[k - 1]);
    }
    expect(pack.rows).toBe(Math.ceil((pack.levelOffsets.at(-1)! + pack.levelCounts.at(-1)!) / TEX_WIDTH));
  });
});
