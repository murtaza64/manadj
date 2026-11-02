import { afterEach, expect, it, vi } from 'vitest';
import { fieldReview, type FieldPlan } from './fieldReview';

afterEach(() => vi.restoreAllMocks());
const plan = { track_ids: [2], fields: ['key'], token: 'token', destination: '/fixture/engine', scope: 'selected', surface: 'engine', direction: 'import', tracks: [] } as unknown as FieldPlan;
const receipt = { ...plan, status: 'complete', verification: 'Writer report', tracks: [{ track_id: 2, title: 'Two', fields: [{ field: 'key', status: 'applied' }] }] };
it.each(['empty', 'wrong target', 'array status', 'missing field'])('classifies %s receipts as unknown', async what => {
  const body = structuredClone(receipt);
  if (what === 'empty') body.tracks = [];
  if (what === 'wrong target') body.surface = 'rekordbox';
  if (what === 'array status') Object.assign(body.tracks[0].fields[0], { status: ['applied'] });
  if (what === 'missing field') body.tracks[0].fields = [];
  // Expected coverage comes from reviewed IDs/fields, not a truthy result list.
  const submitted = { ...plan, tracks: [{ track_id: 2 }] } as FieldPlan;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)));
  await expect(fieldReview.execute(submitted, [])).rejects.toMatchObject({ code: 'unknown' });
});
it('accepts complete receipts and sends no playlist membership/order scope', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(receipt)));
  await expect(fieldReview.execute({ ...plan, tracks: [{ track_id: 2 }] } as FieldPlan, [])).resolves.toEqual(receipt);
  const request = JSON.parse(fetch.mock.calls[0][1]!.body as string);
  expect(request).toEqual({ track_ids: [2], scope: 'selected', direction: 'import', surface: 'engine', fields: ['key'], token: 'token', replacements: [] });
});
