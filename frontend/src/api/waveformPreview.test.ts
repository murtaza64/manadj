import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';

afterEach(() => vi.unstubAllGlobals());

it('returns pending without trying to decode a 202 response', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })));
  expect(await api.waveforms.getPreview(42)).toBeNull();
  expect(fetch).toHaveBeenCalledWith('http://localhost:8127/api/waveforms/42/preview');
});

it('retains the exposed content revision with the binary substrate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { ETag: '"revision"' } })));
  const result = await api.waveforms.getPreview(42);
  expect(result?.etag).toBe('"revision"');
  expect(new Uint8Array(result!.blob)).toEqual(new Uint8Array([1, 2, 3]));
});

it.each([404, 409])('retains status %s for polling and retry decisions', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
  await expect(api.waveforms.getPreview(42)).rejects.toMatchObject({ status });
});
