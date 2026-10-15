import { drawStyledWave, MINIMAP_BRIGHTNESS } from '../sets/ladderWaveStyle';
import { decodeWaveformBlob } from './blob';
import type { SlotState } from './styleSlots';
import type { WaveformPreviewData } from './useWaveformPreview';

// Fixed 2x raster for the 256-column substrate. Resizing the cell stretches the
// image, not the cue markers; it never re-decodes or redraws during a column drag.
//
// Encoding is async (canvas.toBlob → object URL; desktop-perf #385): the
// synchronous toDataURL PNG encode was the largest main-thread cost of a
// fast library scroll. Entries are ~5 KB; the cap covers a whole library
// so scrolling back never re-rasterizes. Evicted URLs are revoked.
let imageCacheLimit = 4096;

/** Test seam: shrink the raster cache bound. */
export function setPreviewImageCacheLimit(limit: number): void {
  imageCacheLimit = limit;
}
const images = new Map<string, string>();
type Listener = (src: string | null) => void;
const pending = new Map<string, { data: WaveformPreviewData; slot: SlotState; listeners: Set<Listener> }>();
/** Drawn, awaiting the async encode: new requests join these listeners. */
const encoding = new Map<string, { data: WaveformPreviewData; slot: SlotState; listeners: Set<Listener> }>();
let frame: number | null = null;

export function previewImageKey(data: WaveformPreviewData, slot: SlotState): string {
  return `${data.etag}:${JSON.stringify(slot)}`;
}

function remember(key: string, src: string): void {
  images.set(key, src);
  if (images.size > imageCacheLimit) {
    const oldest = images.keys().next().value!;
    const url = images.get(oldest)!;
    images.delete(oldest);
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

function paint() {
  frame = null;
  const start = performance.now();
  while (pending.size && performance.now() - start < 4) {
    const [key, job] = pending.entries().next().value!;
    pending.delete(key);
    const deliver = (src: string | null) => {
      for (const listener of job.listeners) listener(src);
    };
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 40;
      // CPU-backed: toBlob on a GPU canvas blocks the main thread on a
      // pixel readback (CommandBufferProxyImpl::WaitForGetOffset).
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        deliver(null);
        continue;
      }
      drawStyledWave(ctx, decodeWaveformBlob(job.data.blob), job.slot.styleId, job.slot.params, {
        width: canvas.width, height: canvas.height, dir: 'bipolar',
        range: [0, job.data.duration], brightness: MINIMAP_BRIGHTNESS,
        transparent: true,
      });
      encoding.set(key, job);
      canvas.toBlob((blob) => {
        encoding.delete(key);
        if (!blob) {
          deliver(null);
          return;
        }
        const src = URL.createObjectURL(blob);
        remember(key, src);
        deliver(src);
      }, 'image/png');
    } catch (error) {
      // A malformed preview or unavailable canvas must not interrupt the table.
      console.warn('Waveform preview render failed', error);
      deliver(null);
    }
  }
  if (pending.size) frame = requestAnimationFrame(paint);
}

/** Bounded raster cache + finite, cancelable draw queue shared by table panes. */
export function requestPreviewImage(data: WaveformPreviewData, slot: SlotState, listener: Listener): () => void {
  const key = previewImageKey(data, slot);
  const cached = images.get(key);
  if (cached) {
    images.delete(key);
    images.set(key, cached);
    listener(cached);
    return () => {};
  }
  let job = pending.get(key) ?? encoding.get(key);
  if (!job) {
    job = { data, slot, listeners: new Set() };
    pending.set(key, job);
  }
  job.listeners.add(listener);
  if (pending.size && frame === null) frame = requestAnimationFrame(paint);
  return () => {
    job.listeners.delete(listener);
    if (!job.listeners.size && pending.get(key) === job) pending.delete(key);
    if (!pending.size && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
}
