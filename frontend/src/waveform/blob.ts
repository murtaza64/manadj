// Waveform data v2 blob decoding + GPU-ready packing (ADR 0014 / ADR 0015).
//
// Decodes the binary blob served by /api/waveforms/{id}/data into typed
// arrays, builds the client-side LOD pyramids, and packs them into tiled
// texture buffers. Aggregation is channel-true (ADR 0015): peaks max,
// bands mean — at every pyramid level.

export const TEX_WIDTH = 4096;
export const MAX_LEVELS = 10;
/** Each LOD level downsamples by this factor. */
export const LEVEL_FACTOR = 4;

export interface WaveformBlobHeader {
  version: number;
  sampleRate: number;
  duration: number;
  peakHop: number;
  bandHop: number;
  stftWindow: number;
  nBands: number;
  gamma: number;
  bandEdges: number[];
  peakCount: number;
  bandCount: number;
}

/** One channel's LOD pyramid, packed into a TEX_WIDTH-tiled texture buffer. */
export interface LodPack {
  data: Uint8Array;
  rows: number;
  /** Texel offset of each level within the tiled texture. */
  levelOffsets: number[];
  /** Element count of each level. */
  levelCounts: number[];
  numLevels: number;
}

export interface DecodedWaveform {
  header: WaveformBlobHeader;
  /** Broadband max-abs peaks: 1 channel (R8), max-aggregated pyramid. */
  peaks: LodPack;
  /** Bands 0-3: RGBA8 per frame, mean-aggregated pyramid. */
  bandsLo: LodPack;
  /** Bands 4-7: RGBA8 per frame, mean-aggregated pyramid. */
  bandsHi: LodPack;
  /** Convenience mirror of header.duration (the render loop's hot field). */
  duration: number;
}

const MAGIC = 'MWF1';
const SUPPORTED_VERSIONS = [1, 2]; // identical layout; v2 = multi-resolution windows

/** Fixed header size: 40 bytes + 9 edge floats + 2 count u32s. */
const MIN_BLOB_BYTES = 40 + 9 * 4 + 8;

export function decodeWaveformBlob(buf: ArrayBuffer): DecodedWaveform {
  if (buf.byteLength < MIN_BLOB_BYTES) {
    throw new Error(`waveform blob: truncated (${buf.byteLength} bytes)`);
  }
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== MAGIC) throw new Error(`waveform blob: bad magic ${magic}`);
  const version = dv.getUint16(4, true);
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error(`waveform blob: unsupported version ${version}`);
  }
  let off = 8;
  const sampleRate = dv.getUint32(off, true); off += 4;
  const duration = dv.getFloat64(off, true); off += 8;
  const peakHop = dv.getUint32(off, true); off += 4;
  const bandHop = dv.getUint32(off, true); off += 4;
  const stftWindow = dv.getUint32(off, true); off += 4;
  const nBands = dv.getUint8(off); off += 4; // u8 + 3 pad bytes
  const gamma = dv.getFloat32(off, true); off += 4;
  const bandEdges: number[] = [];
  for (let i = 0; i <= nBands; i++) {
    bandEdges.push(dv.getFloat32(off, true));
    off += 4;
  }
  const peakCount = dv.getUint32(off, true); off += 4;
  const bandCount = dv.getUint32(off, true); off += 4;

  const expected = off + peakCount + bandCount * nBands;
  if (buf.byteLength < expected) {
    throw new Error(`waveform blob: truncated (${buf.byteLength} < ${expected})`);
  }
  if (nBands !== 8) {
    // The renderer packs bands as exactly two RGBA texels per frame.
    throw new Error(`waveform blob: expected 8 bands, got ${nBands}`);
  }

  const peaksRaw = new Uint8Array(buf, off, peakCount);
  const bandsRaw = new Uint8Array(buf, off + peakCount, bandCount * nBands);

  const header: WaveformBlobHeader = {
    version, sampleRate, duration, peakHop, bandHop, stftWindow,
    nBands, gamma, bandEdges, peakCount, bandCount,
  };
  return {
    header,
    peaks: buildLodPack(peaksRaw, peakCount, 1, 'max'),
    bandsLo: buildLodPack(sliceBands(bandsRaw, bandCount, nBands, 0), bandCount, 4, 'mean'),
    bandsHi: buildLodPack(sliceBands(bandsRaw, bandCount, nBands, 4), bandCount, 4, 'mean'),
    duration,
  };
}

/** Repack frame-major band bytes into RGBA texels for bands [first..first+4). */
function sliceBands(raw: Uint8Array, frames: number, nBands: number, first: number): Uint8Array {
  const out = new Uint8Array(frames * 4);
  for (let f = 0; f < frames; f++) {
    const src = f * nBands + first;
    const dst = f * 4;
    out[dst] = raw[src];
    out[dst + 1] = raw[src + 1];
    out[dst + 2] = raw[src + 2];
    out[dst + 3] = raw[src + 3];
  }
  return out;
}

/**
 * Build a LOD pyramid (level k aggregates LEVEL_FACTOR^k base elements) and
 * pack all levels into one TEX_WIDTH-tiled texture buffer.
 *
 * ADR 0015: peaks aggregate with max (envelope semantics — transients must
 * survive zoom-out); bands aggregate with mean (energy semantics). Do not
 * "unify" these.
 */
export function buildLodPack(
  base: Uint8Array,
  count: number,
  channels: 1 | 4,
  agg: 'max' | 'mean',
): LodPack {
  const levels: Uint8Array[] = [base];
  const counts: number[] = [count];
  while (levels.length < MAX_LEVELS && counts[counts.length - 1] > TEX_WIDTH) {
    const prev = levels[levels.length - 1];
    const prevCount = counts[counts.length - 1];
    const nextCount = Math.ceil(prevCount / LEVEL_FACTOR);
    const next = new Uint8Array(nextCount * channels);
    for (let i = 0; i < nextCount; i++) {
      const j0 = i * LEVEL_FACTOR;
      const j1 = Math.min(j0 + LEVEL_FACTOR, prevCount);
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let j = j0; j < j1; j++) {
          const v = prev[j * channels + c];
          acc = agg === 'max' ? Math.max(acc, v) : acc + v;
        }
        next[i * channels + c] = agg === 'max' ? acc : Math.round(acc / (j1 - j0));
      }
    }
    levels.push(next);
    counts.push(nextCount);
  }

  const levelOffsets: number[] = [];
  let texel = 0;
  for (const c of counts) {
    levelOffsets.push(texel);
    texel += c;
  }
  const rows = Math.max(1, Math.ceil(texel / TEX_WIDTH));
  const data = new Uint8Array(rows * TEX_WIDTH * channels);
  for (let k = 0; k < levels.length; k++) {
    data.set(levels[k], levelOffsets[k] * channels);
  }
  return { data, rows, levelOffsets, levelCounts: counts, numLevels: levels.length };
}
