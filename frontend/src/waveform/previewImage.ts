import { drawStyledWave, MINIMAP_BRIGHTNESS } from '../sets/ladderWaveStyle';
import { decodeWaveformBlob } from './blob';
import type { SlotState } from './styleSlots';
import type { WaveformPreviewData } from './useWaveformPreview';

// Fixed 2x raster for the 256-column substrate. Resizing the cell stretches the
// image, not the cue markers; it never re-decodes or redraws during a column drag.
const images = new Map<string, string>();
type Listener = (src: string | null) => void;
const pending = new Map<string, { data: WaveformPreviewData; slot: SlotState; listeners: Set<Listener> }>();
let frame: number | null = null;

export function previewImageKey(data: WaveformPreviewData, slot: SlotState): string {
  return `${data.etag}:${JSON.stringify(slot)}`;
}

function paint() {
  frame = null;
  const start = performance.now();
  while (pending.size && performance.now() - start < 4) {
    const [key, job] = pending.entries().next().value!;
    pending.delete(key);
    let src: string | null = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 40;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawStyledWave(ctx, decodeWaveformBlob(job.data.blob), job.slot.styleId, job.slot.params, {
          width: canvas.width, height: canvas.height, dir: 'bipolar',
          range: [0, job.data.duration], brightness: MINIMAP_BRIGHTNESS,
          transparent: true,
        });
        src = canvas.toDataURL('image/png');
        images.set(key, src);
        if (images.size > 128) images.delete(images.keys().next().value!);
      }
    } catch (error) {
      // A malformed preview or unavailable canvas must not interrupt the table.
      console.warn('Waveform preview render failed', error);
    }
    for (const listener of job.listeners) listener(src);
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
  let job = pending.get(key);
  if (!job) {
    job = { data, slot, listeners: new Set() };
    pending.set(key, job);
  }
  job.listeners.add(listener);
  if (frame === null) frame = requestAnimationFrame(paint);
  return () => {
    job.listeners.delete(listener);
    if (!job.listeners.size && pending.get(key) === job) pending.delete(key);
    if (!pending.size && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
}
