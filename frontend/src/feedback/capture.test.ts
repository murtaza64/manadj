// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toPng } from 'html-to-image';
import { feedbackApi } from './client';
import { captureFeedback, fitScreenshot, SCREENSHOT_LIMIT } from './capture';
import { captureDiagnostics, installFeedbackErrors, recordError, redact, registerDiagnostics } from './diagnostics';

vi.mock('html-to-image', () => ({ toPng: vi.fn() }));
const png = 'data:image/png;base64,aGVsbG8=';
const context = { origin: { lane: 'lane', owner: 'owner', revision: 'rev' }, destination: 'lane' };
beforeEach(() => {
  vi.spyOn(window, 'Image').mockImplementation(function () {
    const image = { width: 4000, height: 2400, onload: () => {}, set src(_value: string) { this.onload(); } };
    return image as unknown as HTMLImageElement;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete window.manadjFeedback; });

describe('capture', () => {
  it('reads state immediately, initiates context and desktop screenshot before awaiting; freezes results', async () => {
    let position = 1;
    const read = vi.fn(() => ({ position }));
    vi.spyOn(feedbackApi, 'context').mockResolvedValue(context);
    window.manadjFeedback = { captureScreenshot: vi.fn().mockResolvedValue(png) };
    const pending = captureFeedback({ decks: read });
    expect(read).toHaveBeenCalledOnce();
    expect(feedbackApi.context).toHaveBeenCalledOnce();
    position = 2;
    const result = await pending;
    expect(result.snapshot.decks).toEqual({ position: 1 });
    expect(result.screenshot).toBe(png);
    expect(window.manadjFeedback.captureScreenshot).toHaveBeenCalledOnce();
    expect(result.context).toEqual(context);
  });

  it('browser uses DOM capture only and warns about WebGL/canvas', async () => {
    vi.spyOn(feedbackApi, 'context').mockResolvedValue(context);
    vi.mocked(toPng).mockResolvedValue(png);
    const result = await captureFeedback();
    expect(toPng).toHaveBeenCalledWith(document.body, expect.objectContaining({ pixelRatio: 1 }));
    expect(result.warnings.join(' ')).toContain('WebGL/canvas');
  });

  it('timeouts and independent section failure permit reporting without invented origin', async () => {
    vi.useFakeTimers();
    vi.spyOn(feedbackApi, 'context').mockReturnValue(new Promise(() => {}));
    window.manadjFeedback = { captureScreenshot: () => new Promise(() => {}) };
    const pending = captureFeedback({ editor: () => { throw new Error('broken'); }, view: () => 'routine' });
    await vi.advanceTimersByTimeAsync(5001);
    const result = await pending;
    expect(result.context).toBeNull();
    expect(result.screenshot).toBeNull();
    expect(result.snapshot.view).toBe('routine');
    expect(result.warnings.join(' ')).toMatch(/editor.*context.*Screenshot/);
  });

  it('validates PNG and resizes encoded data below the strict limit', async () => {
    await expect(fitScreenshot('data:image/jpeg;base64,abcd')).rejects.toThrow('PNG');
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
    vi.spyOn(window, 'Image').mockImplementation(function () {
      const image = { width: 4000, height: 2400, onload: () => {}, set src(_value: string) { this.onload(); } };
      return image as unknown as HTMLImageElement;
    });
    const result = await fitScreenshot(`data:image/png;base64,${'a'.repeat(SCREENSHOT_LIMIT)}`);
    expect(result.length).toBeLessThan(SCREENSHOT_LIMIT);
    expect(drawImage).toHaveBeenCalled();
  });

  it('rejects undecodable PNG data even below the encoded size cap', async () => {
    vi.spyOn(window, 'Image').mockImplementation(function () {
      const image = { onerror: () => {}, set src(_value: string) { this.onerror(); } };
      return image as unknown as HTMLImageElement;
    });
    await expect(fitScreenshot(png)).rejects.toThrow('decode');
  });

  it('resizes highly compressed PNGs above the backend pixel limit', async () => {
    vi.spyOn(window, 'Image').mockImplementation(function () {
      const image = { width: 6000, height: 6000, onload: () => {}, set src(_value: string) { this.onload(); } };
      return image as unknown as HTMLImageElement;
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
    expect(await fitScreenshot(png)).toBe(png);
    expect(drawImage).toHaveBeenCalled();
  });
});

describe('privacy', () => {
  it('bounds, redacts credentials and URL queries, and omits arbitrary error objects', () => {
    const stop = installFeedbackErrors();
    try {
      window.dispatchEvent(new ErrorEvent('error', { message: 'GET https://user:pass@example.com/api?private=abc Bearer xyz token=foo' }));
      const rejection = new Event('unhandledrejection');
      Object.defineProperty(rejection, 'reason', { value: { password: 'do-not-copy' } });
      window.dispatchEvent(rejection);
      for (let i = 0; i < 20; i++) recordError('test', `password="never share" ${'x'.repeat(3000)}`);
      const snapshot = captureDiagnostics().snapshot;
      expect(snapshot.errors).toHaveLength(12);
      expect(JSON.stringify(snapshot)).not.toMatch(/never share|do-not-copy/);
      expect(JSON.stringify(snapshot).length).toBeLessThan(14000);
      expect(redact('https://user:pass@example.com/path?key=abc#secret Bearer xyz token=foo github_pat_secret')).not.toMatch(/pass@|key=abc|xyz|foo|github_pat_secret/);
    } finally { stop(); }
  });

  it('only captures allowlisted sections and unregisters provider readers', () => {
    const unregister = registerDiagnostics('editor', () => ({ uuid: '123', secret: 'never', nested: { token: 'private' } }));
    const captured = captureDiagnostics({ view: () => 'performance', ...{ settings: () => ({ all: 'private' }) } });
    expect(captured.snapshot.editor).toEqual({ uuid: '123', nested: {} });
    expect(captured.snapshot).not.toHaveProperty('settings');
    unregister();
    expect(captureDiagnostics().snapshot).not.toHaveProperty('editor');
  });

  it('combines editor selection and session IDs without extra subscriptions or losing independent fragments', () => {
    const stops = [
      registerDiagnostics('editor', () => ({ uuid: 'editor-id' })),
      registerDiagnostics('editor', () => ({ selected_slots: ['slot-1'] })),
      registerDiagnostics('editor', () => { throw new Error('partial failure'); }),
      registerDiagnostics('session', () => ({ recording_uuid: 'recording-id' })),
    ];
    try {
      const { snapshot, warnings } = captureDiagnostics({ session: () => ({ selected_uuid: 'selected-id' }) });
      expect(snapshot.editor).toEqual({ uuid: 'editor-id', selected_slots: ['slot-1'] });
      expect(snapshot.session).toEqual({ recording_uuid: 'recording-id', selected_uuid: 'selected-id' });
      expect(warnings).toContain('editor: diagnostics unavailable');
    } finally { stops.forEach((stop) => stop()); }
  });
});
