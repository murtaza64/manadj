// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedbackEntry } from './FeedbackEntry';
import { feedbackApi, type Batch, type Payload, type Report, type Reports } from './client';
import { captureFeedback, type Capture } from './capture';
import RootErrorBoundary from '../components/RootErrorBoundary';

vi.mock('./capture', async (original) => ({ ...await original<typeof import('./capture')>(), captureFeedback: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const origin = { lane: 'captured-lane', owner: 'captured-owner', revision: 'captured-rev' };
const context = { origin, destination: 'captured-lane' };
const capture: Capture = { context, snapshot: { view: 'performance' }, screenshot: 'data:image/png;base64,aGVsbG8=', warnings: [] };
const report: Report = { ...context, id: 'r1', kind: 'bug', title: 'Report one', description: 'details', status: 'filed', issue_url: 'https://github.com/murtaza64/manadj/issues/999', error: null, batch_id: null, created_at: 'now' };
let root: Root;
let host: HTMLDivElement;
let listing: Reports;

beforeEach(() => {
  vi.clearAllMocks();
  listing = { ...context, reports: [], batches: [] };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Tests must mock feedback transports'); }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.mocked(captureFeedback).mockResolvedValue(structuredClone(capture));
  vi.spyOn(feedbackApi, 'reports').mockImplementation(async () => structuredClone(listing));
  vi.spyOn(feedbackApi, 'context').mockResolvedValue(context);
  vi.spyOn(feedbackApi, 'dispatch').mockImplementation(async (ids) => {
    const batch: Batch = { id: 'b1', report_ids: ids, status: 'queued', destination: context.destination, error: null };
    listing.batches.push(batch);
    listing.reports = listing.reports.map((r) => ids.includes(r.id) ? { ...r, batch_id: batch.id } : r);
    return batch;
  });
  vi.spyOn(feedbackApi, 'retryReport').mockResolvedValue(report);
  vi.spyOn(feedbackApi, 'retryBatch').mockResolvedValue({ id: 'b1', report_ids: [], status: 'needs-routing', destination: 'missing', error: 'No target configured' });
  host = document.createElement('div'); document.body.append(host);
  act(() => { root = createRoot(host); root.render(<FeedbackEntry />); });
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
function button(text: string) {
  const buttons = [...document.querySelectorAll('button')].filter((b) => b.textContent === text);
  expect(buttons.length, text).toBeGreaterThan(0);
  return buttons.at(-1)!;
}
async function click(text: string) { await act(async () => { button(text).click(); }); }
async function fill() {
  await act(async () => {
    for (const [selector, value] of [['input:not([type])', 'Broken token=private'], ['textarea', 'Details at https://example.com/api?secret=hidden']]) {
      const el = document.querySelector(selector)!;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

it('does not open the form until capture settles; deduplicates clicks', async () => {
  let resolve!: (value: Capture) => void;
  vi.mocked(captureFeedback).mockReturnValue(new Promise((r) => { resolve = r; }));
  await click('Report bug');
  expect(document.querySelector('dialog')).toBeNull();
  act(() => button('Capturing...').click());
  expect(captureFeedback).toHaveBeenCalledTimes(1);
  await act(async () => resolve(structuredClone(capture)));
  expect(document.querySelector('dialog')?.open).toBe(true);
  expect(document.body.textContent).toContain('File a report');
});

it('permits failure fallback and context retry without recapturing or losing form text', async () => {
  vi.mocked(captureFeedback).mockResolvedValue({ ...capture, context: null, screenshot: null, warnings: ['Screenshot unavailable'] });
  await click('Request feature'); await fill();
  expect(button('File report on GitHub').disabled).toBe(true);
  expect(document.querySelector('input[type=file]')).not.toBeNull();
  await click('Retry context');
  expect(button('File report on GitHub').disabled).toBe(false);
  expect(document.querySelector('select')?.value).toBe('feature');
  expect(document.querySelector('textarea')?.value).toContain('Details');
  expect(captureFeedback).toHaveBeenCalledTimes(1);
});

it('validates text, previews redaction, removes attachments, and retries one immutable UUID after ambiguous filing', async () => {
  const payloads: Payload[] = [];
  vi.spyOn(feedbackApi, 'file').mockImplementation(async (payload) => {
    payloads.push(payload);
    if (payloads.length === 1) throw new Error('Timed out; may be saved');
    return { ...report, id: payload.id };
  });
  await click('Report bug'); await click('File report on GitHub');
  expect(document.body.textContent).toContain('Title and detailed description are required');
  expect(feedbackApi.file).not.toHaveBeenCalled();
  await fill();
  expect(document.querySelector('[aria-label="GitHub summary preview"]')?.textContent).not.toMatch(/private|hidden/);
  await click('Remove screenshot'); await click('Remove diagnostics'); await click('File report on GitHub');
  expect(document.querySelector('fieldset')?.disabled).toBe(true);
  await click('Close'); await click('Resume report');
  await click('Retry same report');
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toBe(payloads[1]);
  expect(payloads[0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(payloads[0]).toMatchObject({ origin, snapshot: {}, screenshot: null });
  expect(JSON.stringify(payloads)).not.toMatch(/private|hidden/);
  expect(feedbackApi.dispatch).not.toHaveBeenCalled();
});

it('polls status without mutation; closing, reopening, and filing never dispatch; explicit dispatch freezes eligible IDs only', async () => {
  listing.reports = [report, { ...report, id: 'failed', status: 'filing_failed' }, { ...report, id: 'batched', batch_id: 'old' }];
  await click('Feedback queue');
  expect(document.body.textContent).toContain('captured-lane');
  expect(document.querySelector('a')?.href).toContain('/issues/999');
  await click('Close'); await click('Feedback queue');
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(feedbackApi.dispatch).not.toHaveBeenCalled();
  await click('Send feedback (1)');
  expect(feedbackApi.dispatch).toHaveBeenCalledExactlyOnceWith(['r1']);
  expect(document.body.textContent).toContain('Queued; waiting');
  listing.reports.push({ ...report, id: 'later' });
  await click('Refresh status');
  expect(button('Send feedback (1)')).toBeDefined();
  expect(listing.batches[0].report_ids).toEqual(['r1']);
  await click('Close');
  expect(feedbackApi.dispatch).toHaveBeenCalledTimes(1);
});

it('only unlocks an ambiguous payload for a new identity after explicit confirmation', async () => {
  vi.spyOn(feedbackApi, 'file').mockRejectedValue(new Error('Unavailable'));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await click('Report bug'); await fill(); await click('File report on GitHub');
  const first = vi.mocked(feedbackApi.file).mock.calls[0][0];
  await click('Edit as a new report');
  expect(document.querySelector('fieldset')?.disabled).toBe(true);
  confirm.mockReturnValue(true);
  await click('Edit as a new report');
  expect(document.querySelector('fieldset')?.disabled).toBe(false);
  await click('File report on GitHub');
  expect(vi.mocked(feedbackApi.file).mock.calls[1][0].id).not.toBe(first.id);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('may duplicate'));
});

it('shows uncertain filing, submitted vs delivered, and needs-routing with explicit retries only', async () => {
  listing.reports = [{ ...report, status: 'filing_uncertain', error: 'Timeout token=private' }];
  listing.batches = [
    { id: 'b1', report_ids: ['r1'], status: 'submitted', destination: 'lane', error: null },
    { id: 'b2', report_ids: [], status: 'needs-routing', destination: 'missing', error: 'No target configured' },
  ];
  await click('Feedback queue');
  expect(document.body.textContent).toContain('not acknowledged');
  expect(document.body.textContent).toContain('Needs routing');
  expect(document.body.textContent).not.toContain('private');
  expect(feedbackApi.retryBatch).not.toHaveBeenCalled();
  await click('Retry GitHub filing');
  expect(feedbackApi.retryReport).toHaveBeenCalledExactlyOnceWith('r1');
  await click('Retry authorized batch');
  expect(feedbackApi.retryBatch).toHaveBeenCalledExactlyOnceWith('b2');
});

it('reloads pending reports from the server after a remount, without dispatching', async () => {
  listing.reports = [{ ...report, status: 'pending' }];
  await click('Feedback queue');
  expect(document.body.textContent).toContain('Pending GitHub filing');
  act(() => { root.unmount(); root = createRoot(host); root.render(<FeedbackEntry />); });
  await click('Feedback queue');
  expect(document.body.textContent).toContain('Report one');
  expect(document.body.textContent).toContain('Pending GitHub filing');
  expect(feedbackApi.dispatch).not.toHaveBeenCalled();
});

it('blocks playback keyboard handlers, supports Escape, and keeps a closed draft', async () => {
  const shortcut = vi.fn();
  document.addEventListener('keydown', shortcut, true);
  try {
    await click('Report bug'); await fill();
    act(() => { document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(shortcut).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.querySelector('dialog')).toBeNull();
    await click('Resume report');
    expect(document.querySelector('textarea')?.value).toContain('Details');
    expect(feedbackApi.dispatch).not.toHaveBeenCalled();
  } finally { document.removeEventListener('keydown', shortcut, true); }
});

it('offers crash reporting without DeckProvider or QueryClient', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Bomb(): never { throw new Error('render broke'); }
  act(() => root.render(<RootErrorBoundary><Bomb /></RootErrorBoundary>));
  await click('Report bug');
  const readers = vi.mocked(captureFeedback).mock.calls.at(-1)![0]!;
  expect(readers.crash!()).toMatchObject({ message: 'render broke' });
  expect(document.body.textContent).toContain('File a report');
});
