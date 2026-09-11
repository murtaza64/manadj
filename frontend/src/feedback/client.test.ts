// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { feedbackApi, FeedbackError, type Payload } from './client';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('uses the dedicated prefix, feedback header, and JSON posts for every endpoint', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetch);
  await feedbackApi.context(); await feedbackApi.reports();
  const payload: Payload = { id: 'id', kind: 'bug', title: 'title', description: 'details',
    origin: { lane: null, owner: null, revision: null }, snapshot: {}, screenshot: null, capture_warnings: [] };
  await feedbackApi.file(payload); await feedbackApi.retryReport('id');
  await feedbackApi.dispatch(['id']); await feedbackApi.retryBatch('batch');
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
    '/api/feedback/context', '/api/feedback/reports', '/api/feedback/reports',
    '/api/feedback/reports/id/retry', '/api/feedback/dispatch', '/api/feedback/batches/batch/retry',
  ]);
  for (const [, options] of fetch.mock.calls) {
    expect(options.headers['X-Manadj-Feedback']).toBe('1');
    if (options.method === 'POST') expect(options.headers['Content-Type']).toBe('application/json');
  }
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual(payload);
  expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({ report_ids: ['id'] });
});

it('aborts hung requests without pretending they failed before persistence', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
  })));
  const pending = expect(feedbackApi.reports()).rejects.toThrow('server may have saved it');
  await vi.advanceTimersByTimeAsync(15001);
  await pending;
});

it('exposes HTTP conflict status with a safe recovery message, never raw server details', async () => {
  const json = vi.fn(async () => ({ detail: 'private path and password=secret' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json }));
  const error = await feedbackApi.context().catch((e) => e);
  expect(error).toBeInstanceOf(FeedbackError);
  expect(error.status).toBe(409);
  expect(error.message).toContain('recapture');
  expect(error.message).not.toMatch(/private|secret/);
  expect(json).not.toHaveBeenCalled();
});

it('keeps network failures distinct from definite conflicts without exposing transport secrets', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret transport payload')));
  const error = await feedbackApi.context().catch((e) => e);
  expect(error).toBeInstanceOf(FeedbackError);
  expect(error.status).toBeNull();
  expect(error.message).toContain('server may have saved it');
  expect(error.message).not.toContain('secret');
});
