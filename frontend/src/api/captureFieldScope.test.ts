import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { captureActiveLibraryIds } from './captureFieldScope';
afterEach(() => vi.restoreAllMocks());
it('captures all active IDs rather than using the first rendered page', async () => {
  const list = vi.spyOn(api.tracks, 'list').mockResolvedValue({ items: [{ id: 1 }, { id: 2 }], total: 2 });
  await expect(captureActiveLibraryIds()).resolves.toEqual([1, 2]);
  expect(list).toHaveBeenCalledWith(1, 10000);
});
it('rejects incomplete scope instead of silently truncating', async () => {
  vi.spyOn(api.tracks, 'list').mockResolvedValue({ items: [{ id: 1 }], total: 10001 });
  await expect(captureActiveLibraryIds()).rejects.toThrow('complete Library scope');
});
