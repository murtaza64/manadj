/** One viewport plus pan overscan, never a whole-track bitmap. The owner
 * recreates the painter when waveform, style, runs or modulation change. */
export function createWaveformViewport(
  draw: (ctx: CanvasRenderingContext2D, left: number, width: number, pxPerBeat: number, height: number) => void,
) {
  let cached: { left: number; width: number; viewWidth: number; pxPerBeat: number; height: number; dpr: number } | null = null;
  return (canvas: HTMLCanvasElement, left: number, pxPerBeat: number, width: number, height: number, dpr: number) => {
    const offset = cached ? (left - cached.left) * dpr : 0;
    if (!cached || cached.pxPerBeat !== pxPerBeat || cached.height !== height ||
        cached.viewWidth !== width || cached.dpr !== dpr || left < cached.left ||
        left + width > cached.left + cached.width || Math.abs(offset - Math.round(offset)) > 1e-6) {
      // Zoom invalidates the raster every frame; overscan only pays off for pan.
      const zooming = !cached || cached.pxPerBeat !== pxPerBeat;
      const margin = zooming ? 0 : Math.max(0, Math.min(Math.ceil(width / 2), Math.floor((8192 / dpr - width) / 2)));
      const spanWidth = width + margin * 2;
      const spanLeft = left - Math.floor(margin * dpr) / dpr;
      const w = Math.ceil(spanWidth * dpr);
      const h = Math.ceil(height * dpr);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      canvas.style.width = `${w / dpr}px`;
      const raster = canvas.getContext('2d');
      if (!raster) return;
      raster.setTransform(dpr, 0, 0, dpr, 0, 0);
      raster.clearRect(0, 0, spanWidth, height);
      draw(raster, spanLeft, spanWidth, pxPerBeat, height);
      cached = { left: spanLeft, width: spanWidth, viewWidth: width, pxPerBeat, height, dpr };
    }
    canvas.style.transform = `translateX(${cached.left - left}px)`;
  };
}
