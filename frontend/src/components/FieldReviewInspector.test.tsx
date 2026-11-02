// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { FieldReviewInspector } from './FieldReviewInspector';
import { fieldReview, FieldRequestError, type FieldPlan } from '../api/fieldReview';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, client: QueryClient;
afterEach(() => { if (root) act(() => root.unmount()); client?.clear(); vi.restoreAllMocks(); document.body.innerHTML = ''; });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!; }
const plan: FieldPlan = { track_ids: [2], scope: 'selected', surface: 'engine', direction: 'import', fields: ['key', 'hotcues', 'maincue'], token: 'token', destination: '/fixture/engine', executable: true, warnings: [], tracks: [{ track_id: 2, title: 'Two', filename: '/fixture/two.flac', fields: [
  { field: 'key', before: 1, before_known: true, after: 2, action: 'consent', reason: 'Requires consent' },
  { field: 'hotcues', before: [], before_known: true, after: [{ slot: 1, time: 1 }], action: 'fill', reason: null },
  { field: 'maincue', before: null, before_known: true, after: null, action: 'skip', reason: 'Source empty' },
] }] };
async function render() {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['app-config'], { export_enabled: true });
  // Preserve direct inspector/guard regressions; entry routing is now tested
  // through the real Sync workspace instead of expecting the old Library modal.
  await act(async () => { root.render(<QueryClientProvider client={client}><FieldReviewInspector initialScope="selected" onClose={() => undefined} scopes={{ selected: async () => [2], filtered: async () => [2, 3] }} /></QueryClientProvider>); await tick(); });
}
it('captures exact selected IDs and sends only separately selected replacements once', async () => {
  const preview = vi.spyOn(fieldReview, 'plan').mockResolvedValue(plan);
  const execute = vi.spyOn(fieldReview, 'execute').mockImplementation(() => new Promise(() => {}));
  await render();
  await act(async () => { button('Recheck plan').click(); await tick(); });
  expect(preview).toHaveBeenCalledWith({ track_ids: [2], scope: 'selected', surface: 'engine', direction: 'import', fields: ['key', 'hotcues', 'maincue'] });
  expect(button('Apply 1 fields').disabled).toBe(false);
  await act(async () => { document.querySelector<HTMLInputElement>('.field-replacement input')!.click(); await tick(); });
  await act(async () => { button('Apply 2 fields').click(); button('Apply 2 fields').click(); await tick(); });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledWith(plan, [{ track_id: 2, field: 'key' }]);
  expect(button('Close').disabled).toBe(true);
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
it('drops old plans and consent on a scope change', async () => {
  vi.spyOn(fieldReview, 'plan').mockResolvedValue(plan);
  await render();
  await act(async () => { button('Recheck plan').click(); await tick(); });
  await act(async () => { const select = document.querySelector<HTMLSelectElement>('[aria-label="Field scope"]')!; select.value = 'filtered'; select.dispatchEvent(new Event('change', { bubbles: true })); await tick(); });
  expect(button('Apply 0 fields').disabled).toBe(true);
  expect(document.querySelector('.field-replacement')).toBeNull();
});
it('keeps lost/incomplete receipts unknown and offers observation, not retry', async () => {
  vi.spyOn(fieldReview, 'plan').mockResolvedValue(plan);
  vi.spyOn(fieldReview, 'execute').mockRejectedValue(new FieldRequestError('Receipt lost', 'unknown'));
  await render();
  await act(async () => { button('Recheck plan').click(); await tick(); });
  await act(async () => { button('Apply 1 fields').click(); await tick(); });
  expect(document.body.textContent).toContain('Outcome unknown');
  expect(button('Apply 1 fields').disabled).toBe(true);
  expect(button('Inspect destination, then recheck')).toBeTruthy();
});
