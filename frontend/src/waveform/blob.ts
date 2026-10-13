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

/** Classic 3-band arrays derived from the 8-band matrix — for consumers
 * that draw their own 2D visuals (e.g. the editor's global minimap). */
export interface ThreeBandWaveform {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  duration: number;
}

/**
 * Collapse the stored 8 bands into low/mid/high group amplitudes at band-frame
 * resolution, using the same grouping/RMS math as the shader's groupAmps.
 */
export function toThreeBands(
  d: DecodedWaveform,
  b1 = 3,
  b2 = 5,
  gains: [number, number, number] = [1, 1, 1],
): ThreeBandWaveform {
  const frames = d.header.bandCount;
  const invGamma = 1 / d.header.gamma;
  const lo = d.bandsLo.data;
  const hi = d.bandsHi.data;
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);
  const dequant = (q: number) => (q / 255) ** invGamma;
  for (let f = 0; f < frames; f++) {
    let e0 = 0;
    let e1 = 0;
    let e2 = 0;
    for (let band = 0; band < 8; band++) {
      const q = band < 4 ? lo[f * 4 + band] : hi[f * 4 + band - 4];
      const a = dequant(q);
      const e = a * a;
      if (band < b1) e0 += e;
      else if (band < b2) e1 += e;
      else e2 += e;
    }
    low[f] = Math.min(1, Math.sqrt(e0) * gains[0]);
    mid[f] = Math.min(1, Math.sqrt(e1) * gains[1]);
    high[f] = Math.min(1, Math.sqrt(e2) * gains[2]);
  }
  return { low, mid, high, duration: d.duration };
}

const MAGIC = 'MWF1';
const SUPPORTED_VERSIONS = [1, 2]; // identical layout; v2 = multi-resolution windows

/** Fixed header size: 40 bytes + 9 edge floats + 2 count u32s. */
const MIN_BLOB_BYTES = 40 + 9 * 4 + 8;

/** The blob's raw arrays, pre-LOD-packing — the compositing substrate
 * (stems #213). `peaks`/`bands` view the source buffer (no copy). */
export interface ParsedWaveformArrays {
  header: WaveformBlobHeader;
  peaks: Uint8Array;
  /** Frame-major [bandCount × nBands]. */
  bands: Uint8Array;
}

export function decodeWaveformBlob(buf: ArrayBuffer): DecodedWaveform {
  const parsed = parseWaveformArrays(buf);
  return packWaveformArrays(parsed);
}

/** LOD-pack parsed arrays into the renderer's DecodedWaveform shape. */
export function packWaveformArrays(parsed: ParsedWaveformArrays): DecodedWaveform {
  const { header, peaks, bands } = parsed;
  const { peakCount, bandCount, nBands } = header;
  return {
    header,
    peaks: buildLodPack(peaks, peakCount, 1, 'max'),
    bandsLo: buildLodPack(sliceBands(bands, bandCount, nBands, 0), bandCount, 4, 'mean'),
    bandsHi: buildLodPack(sliceBands(bands, bandCount, nBands, 4), bandCount, 4, 'mean'),
    duration: header.duration,
  };
}

export function parseWaveformArrays(buf: ArrayBuffer): ParsedWaveformArrays {
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
  return { header, peaks: peaksRaw, bands: bandsRaw };
}

/** Pad/trim a parsed blob to exact counts (stems #213): the renderer's
 * per-stem texture sets must be LOD-identical to the mix blob's, sharing
 * one set of level uniforms. Missing frames read as silence. */
export function padParsedWaveform(
  parsed: ParsedWaveformArrays,
  target: { peakCount: number; bandCount: number }
): ParsedWaveformArrays {
  const { header, peaks, bands } = parsed;
  const nBands = header.nBands;
  if (header.peakCount === target.peakCount && header.bandCount === target.bandCount) {
    return parsed;
  }
  const outPeaks = new Uint8Array(target.peakCount);
  outPeaks.set(peaks.subarray(0, Math.min(peaks.length, target.peakCount)));
  const outBands = new Uint8Array(target.bandCount * nBands);
  outBands.set(bands.subarray(0, Math.min(bands.length, target.bandCount * nBands)));
  return {
    header: { ...header, peakCount: target.peakCount, bandCount: target.bandCount },
    peaks: outPeaks,
    bands: outBands,
  };
}

/**
 * REFERENCE implementation of the stem-composite math (stems #213): the
 * shader's per-texel combination (WaveformRendererV2 fetch wrappers) must
 * agree with this — peaks clamped linear sum, bands power sum — and the
 * unit tests here are the executable spec. Runtime compositing happens
 * GPU-side (per-column mask texture), so this is not on any hot path.
 *
 * Composite per-stem waveforms into one DecodedWaveform for the ACTIVE
 * stems (stems #213). Dequantizes through the stored gamma, combines —
 * peaks as a clamped linear sum (per-bin max-abs of a sum is bounded by
 * the sum of maxes; exact when stems peak in phase), bands as a power sum
 * sqrt(Σa²) (exact for uncorrelated content) — and requantizes. Frame
 * counts may differ by a frame across stems; the composite uses the min.
 */
export function compositeStemWaveforms(
  stems: ParsedWaveformArrays[],
  active: boolean[],
  /** Pad/trim to these counts (stems #213 split mode: the renderer's
   * second texture set must be LOD-identical to the mix blob's). */
  target?: { peakCount: number; bandCount: number }
): DecodedWaveform {
  if (stems.length === 0) throw new Error('compositeStemWaveforms: no stems');
  const head = stems[0].header;
  const invGamma = 1 / head.gamma;
  // Dequant LUT: stored q -> linear amplitude.
  const amp = new Float32Array(256);
  for (let q = 0; q < 256; q++) amp[q] = Math.pow(q / 255, invGamma);

  const availPeaks = Math.min(...stems.map((s) => s.header.peakCount));
  const availBands = Math.min(...stems.map((s) => s.header.bandCount));
  const peakCount = target?.peakCount ?? availPeaks;
  const bandCount = target?.bandCount ?? availBands;
  const nBands = head.nBands;

  const peakSum = new Float32Array(peakCount);
  const bandPow = new Float32Array(bandCount * nBands);
  const peakLimit = Math.min(peakCount, availPeaks);
  const bandLimit = Math.min(bandCount, availBands) * nBands;
  for (let i = 0; i < stems.length; i++) {
    if (!active[i]) continue;
    const sp = stems[i].peaks;
    for (let f = 0; f < peakLimit; f++) peakSum[f] += amp[sp[f]];
    const sb = stems[i].bands;
    for (let f = 0; f < bandLimit; f++) {
      const a = amp[sb[f]];
      bandPow[f] += a * a;
    }
  }

  const peaks = new Uint8Array(peakCount);
  for (let f = 0; f < peakCount; f++) {
    peaks[f] = Math.round(Math.min(1, peakSum[f]) ** head.gamma * 255);
  }
  const bands = new Uint8Array(bandCount * nBands);
  for (let f = 0; f < bandCount * nBands; f++) {
    bands[f] = Math.round(Math.min(1, Math.sqrt(bandPow[f])) ** head.gamma * 255);
  }

  const header: WaveformBlobHeader = { ...head, peakCount, bandCount };
  return packWaveformArrays({ header, peaks, bands });
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
