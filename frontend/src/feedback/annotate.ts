/**
 * Screenshot annotation (feedback #518): freehand pen strokes over the
 * captured screenshot. Strokes live as normalized (0..1) coordinates so
 * the preview scales; they are baked into the PNG only when the report is
 * filed, keeping the working screenshot removable/restorable until then.
 */
import { fitScreenshot } from './capture';
import type { PointerInfo } from './pointer';

export interface Stroke {
  color: string;
  /** Pen width as a fraction of image width. */
  width: number;
  /** Normalized points (0..1 across the image). */
  points: { x: number; y: number }[];
}

// Fixed baked-pixel palette (Catppuccin): readable on dark and light UI.
export const PEN_COLORS = ['#f9e2af', '#f38ba8', '#a6e3a1', '#89b4fa'] as const;
export const PEN_WIDTH = 0.006;
const HIGHLIGHT_COLOR = '#f9e2af';

/** Clamp a client point into the element's normalized (0..1) frame. */
export function normalizePoint(clientX: number, clientY: number, bounds: DOMRect): { x: number; y: number } {
  return {
    x: Math.min(1, Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width))),
    y: Math.min(1, Math.max(0, (clientY - bounds.top) / Math.max(1, bounds.height))),
  };
}

/** Drop redundant points so long scribbles stay bounded. */
export function appendPoint(points: Stroke['points'], next: { x: number; y: number }): Stroke['points'] {
  const last = points.at(-1);
  if (last && Math.hypot(next.x - last.x, next.y - last.y) < 0.002) return points;
  return points.length >= 400 ? points : [...points, next];
}

export function renderAnnotations(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  strokes: Stroke[],
  pointer: PointerInfo | null,
  viewport: { width: number; height: number },
): void {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    context.strokeStyle = stroke.color;
    context.lineWidth = Math.max(2, stroke.width * width);
    context.beginPath();
    context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height);
    if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * width + 0.5, stroke.points[0].y * height + 0.5);
    context.stroke();
  }
  if (pointer) {
    // The pointer rect is in viewport CSS pixels; the screenshot may be
    // scaled (Electron capture), so map through the captured viewport.
    const scaleX = width / Math.max(1, viewport.width);
    const scaleY = height / Math.max(1, viewport.height);
    context.strokeStyle = HIGHLIGHT_COLOR;
    context.lineWidth = Math.max(3, 0.004 * width);
    context.strokeRect(
      pointer.rect.x * scaleX,
      pointer.rect.y * scaleY,
      Math.max(6, pointer.rect.width * scaleX),
      Math.max(6, pointer.rect.height * scaleY),
    );
  }
}

function loadImage(data: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode screenshot'));
    image.src = data;
  });
}

/** Bake strokes + the pointer highlight into the screenshot PNG. */
export async function compositeScreenshot(
  base: string,
  strokes: Stroke[],
  pointer: PointerInfo | null,
  capturedViewport?: unknown,
): Promise<string> {
  if (strokes.length === 0 && !pointer) return base;
  const image = await loadImage(base);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Annotation canvas unavailable');
  context.drawImage(image, 0, 0);
  const viewport = capturedViewport as { width?: unknown; height?: unknown } | undefined;
  renderAnnotations(context, canvas.width, canvas.height, strokes, pointer, {
    width: typeof viewport?.width === "number" ? viewport.width : window.innerWidth,
    height: typeof viewport?.height === "number" ? viewport.height : window.innerHeight,
  });
  return fitScreenshot(canvas.toDataURL('image/png'));
}
