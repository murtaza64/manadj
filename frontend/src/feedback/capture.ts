import { toPng } from 'html-to-image';
import { feedbackApi, type Context } from './client';
import { captureDiagnostics, type Readers, type Snapshot } from './diagnostics';

declare global {
  interface Window {
    manadjFeedback?: { captureScreenshot(): Promise<string> };
  }
}

export interface Capture {
  snapshot: Snapshot; screenshot: string | null; warnings: string[]; context: Context | null;
}
export const SCREENSHOT_LIMIT = 4 * 1024 * 1024;

export async function withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Capture timed out')), ms);
    })]);
  } finally { clearTimeout(timer!); }
}

export async function fitScreenshot(data: string): Promise<string> {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)) throw new Error('Expected a PNG screenshot');
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not decode screenshot'));
    image.src = data;
  });
  // Validate decoding even for small uploads. Encoded length includes the
  // data URL prefix, deliberately below 4 MiB.
  if (data.length < SCREENSHOT_LIMIT && image.width * image.height <= 32_000_000) return data;
  const canvas = document.createElement('canvas');
  let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  for (let attempt = 0; attempt < 8; attempt++, scale *= 0.65) {
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Screenshot resizing unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/png');
    if (result.startsWith('data:image/png;base64,') && result.length < SCREENSHOT_LIMIT) return result;
  }
  throw new Error('Screenshot exceeds 4 MiB');
}

export async function captureFeedback(readers: Readers = {}): Promise<Capture> {
  const { snapshot, warnings } = captureDiagnostics(readers);
  // Start both before returning control to the form. Each attachment can fail
  // independently; no late promise is allowed to replace the frozen bundle.
  const contextPromise = withTimeout(feedbackApi.context()).catch(() => {
    warnings.push('Feedback context unavailable. Retry context before filing; no origin has been guessed.');
    return null;
  });
  const desktop = window.manadjFeedback;
  if (!desktop) warnings.push('Browser capture is best-effort: WebGL/canvas content may be incomplete.');
  const screenshotPromise = withTimeout(Promise.resolve().then(() => desktop
    ? desktop.captureScreenshot()
    : toPng(document.body, {
      width: window.innerWidth, height: window.innerHeight, pixelRatio: 1,
      skipFonts: true,
      filter: (node) => !(node instanceof Element && node.matches('input[type="password"], [data-feedback-private]')),
    })).then(fitScreenshot)).catch(() => {
      warnings.push('Screenshot unavailable or timed out. You can report without it or attach a PNG.');
      return null;
    });
  const [context, screenshot] = await Promise.all([contextPromise, screenshotPromise]);
  return { snapshot, screenshot, warnings: [...warnings], context };
}
