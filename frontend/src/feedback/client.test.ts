// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { feedbackApi, type Payload } from './client';

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
