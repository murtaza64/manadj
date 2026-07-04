// PROTOTYPE — wipe me. Part of the waveform-overhaul prototype
// (.scratch/waveform-overhaul/PRD.md). Decodes .wfb blobs (format v1, see
// scripts/proto_waveform_blob.py) and builds LOD pyramids packed into
// tiled texture data.

export const TEX_W = 4096;
export const MAX_LEVELS = 10;
/** Each LOD level downsamples by this factor. */
export const LEVEL_FACTOR = 4;

export interface WfbHeader {
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

export interface LodPack {
  /** Tiled texture data, width TEX_W, `rows` rows, `channels` bytes per texel. */
  data: Uint8Array;
  rows: number;
  /** Texel offset of each level within the tiled texture. */
  levelOffsets: number[];
  /** Element count of each level. */
  levelCounts: number[];
  numLevels: number;
}

export interface DecodedWfb {
  header: WfbHeader;
  peaks: LodPack; // 1 channel (R8), max-aggregated
  bandsLo: LodPack; // 4 channels (RGBA8) = bands 0-3, mean-aggregated
  bandsHi: LodPack; // 4 channels (RGBA8) = bands 4-7, mean-aggregated
}

export function decodeWfb(buf: ArrayBuffer): DecodedWfb {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'MWF1') throw new Error(`bad magic: ${magic}`);
  const version = dv.getUint16(4, true);
  // v1 = single-window bands; v2 = multi-resolution windows (identical layout).
  if (version !== 1 && version !== 2) throw new Error(`unsupported version: ${version}`);
  let off = 8;
  const sampleRate = dv.getUint32(off, true); off += 4;
  const duration = dv.getFloat64(off, true); off += 8;
  const peakHop = dv.getUint32(off, true); off += 4;
  const bandHop = dv.getUint32(off, true); off += 4;
  const stftWindow = dv.getUint32(off, true); off += 4;
  const nBands = dv.getUint8(off); off += 4; // u8 + 3 pad
  const gamma = dv.getFloat32(off, true); off += 4;
  const bandEdges: number[] = [];
  for (let i = 0; i <= nBands; i++) { bandEdges.push(dv.getFloat32(off, true)); off += 4; }
  const peakCount = dv.getUint32(off, true); off += 4;
  const bandCount = dv.getUint32(off, true); off += 4;

  const peaksRaw = new Uint8Array(buf, off, peakCount); off += peakCount;
  const bandsRaw = new Uint8Array(buf, off, bandCount * nBands); // frame-major

  const header: WfbHeader = {
    sampleRate, duration, peakHop, bandHop, stftWindow,
    nBands, gamma, bandEdges, peakCount, bandCount,
  };

  return {
    header,
    peaks: buildLodPack(peaksRaw, peakCount, 1, 'max'),
    bandsLo: buildLodPack(sliceBands(bandsRaw, bandCount, nBands, 0), bandCount, 4, 'mean'),
    bandsHi: buildLodPack(sliceBands(bandsRaw, bandCount, nBands, 4), bandCount, 4, 'mean'),
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
 * Build a LOD pyramid (level k = aggregate of LEVEL_FACTOR^k base elements;
 * max for peaks so transients survive zoom-out, mean for band color) and pack
 * all levels into one TEX_W-tiled texture buffer.
 */
function buildLodPack(
  base: Uint8Array, count: number, channels: number, agg: 'max' | 'mean',
): LodPack {
  const levels: Uint8Array[] = [base];
  const counts: number[] = [count];
  while (levels.length < MAX_LEVELS && counts[counts.length - 1] > TEX_W) {
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
  const rows = Math.ceil(texel / TEX_W);
  const data = new Uint8Array(rows * TEX_W * channels);
  for (let k = 0; k < levels.length; k++) {
    data.set(levels[k], levelOffsets[k] * channels);
  }
  return { data, rows, levelOffsets, levelCounts: counts, numLevels: levels.length };
}
