/// <reference lib="webworker" />
/**
 * JPEG encoder worker (#377): takes a transferred ImageBitmap, encodes it
 * via OffscreenCanvas.convertToBlob, returns the bytes. Keeps the ~20 ms
 * encode of a 1080×1920 frame off the rendering thread.
 */
interface EncodeRequest { id: number; bitmap: ImageBitmap; quality: number }

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = async (e: MessageEvent<EncodeRequest>) => {
  const { id, bitmap, quality } = e.data;
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    ctx = canvas.getContext('2d', { alpha: false });
  }
  ctx!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  const bytes = await blob.arrayBuffer();
  (self as unknown as Worker).postMessage({ id, bytes }, [bytes]);
};
