// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedbackEntry } from './FeedbackEntry';
import { feedbackApi, FeedbackError, type Batch, type Payload, type Report, type Reports } from './client';
import { captureFeedback, type Capture } from './capture';
import RootErrorBoundary from '../components/RootErrorBoundary';
import { DeckKeys } from '../components/performance/DeckKeys';

const engine = vi.hoisted(() => ({
  jumpBeats: vi.fn(), setBend: vi.fn(), cueUp: vi.fn(), cueDown: vi.fn(), togglePlay: vi.fn(), toggleLoop: vi.fn(),
  getSnapshot: vi.fn(() => ({ playing: false, loadState: 'ready', trackId: 7, bendPercent: 0, scratching: false, vinylMode: true })),
  subscribe: vi.fn(() => () => {}), addTransportEventListener: vi.fn(() => () => {}),
  endScratch: vi.fn(),
}));
const hotCues = vi.hoisted(() => ({ enabled: true, down: vi.fn(), up: vi.fn() }));
vi.mock('../hooks/useMixer', () => ({ useMixer: () => ({
  getChannelState: () => ({ filter: 0, eq: { high: 0.5, mid: 0.5, low: 0.5 }, fader: 0.5 }),
}) }));
vi.mock('../hooks/useDeck', () => ({
  useDeck: () => ({ deck: 'A', engine, loadedTrack: { id: 7 }, beatjumpBeats: 32 }),
  useDeckReady: () => true, useDeckSnapshot: () => true,
}));
vi.mock('../hooks/useHotCueActions', () => ({
  useHotCueActions: () => hotCues,
}));

vi.mock('./capture', async (original) => ({ ...await original<typeof import('./capture')>(), captureFeedback: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const origin = { lane: 'captured-lane', owner: 'captured-owner', revision: 'captured-rev' };
const context = { origin, destination: 'captured-lane' };
const capture: Capture = { context, snapshot: { view: 'performance' }, screenshot: 'data:image/png;base64,aGVsbG8=', warnings: [] };
const report: Report = { ...context, id: 'r1', kind: 'bug', title: 'Report one', description: 'details', status: 'filed', issue_url: 'https://github.com/murtaza64/manadj/issues/999', error: null, batch_id: null, created_at: 'now' };
let root: Root;
let host: HTMLDivElement;
let listing: Reports;

beforeEach(async () => {
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
  await act(async () => { root = createRoot(host); root.render(<FeedbackEntry />); });
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
async function queue() {
  await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Queue ('))!.click(); });
}
async function feature() {
  await act(async () => {
    const select = document.querySelector('select')!;
    select.value = 'feature'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
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
  await click('Feedback');
  expect(document.querySelector('dialog')).toBeNull();
  act(() => button('Capturing...').click());
  expect(captureFeedback).toHaveBeenCalledTimes(1);
  await act(async () => resolve(structuredClone(capture)));
  expect(document.querySelector('dialog')?.open).toBe(true);
  expect(document.body.textContent).toContain('File a report');
});

it('permits failure fallback and context retry without recapturing or losing form text', async () => {
  vi.mocked(captureFeedback).mockResolvedValue({ ...capture, context: null, screenshot: null, warnings: ['Screenshot unavailable'] });
  await click('Feedback'); await feature(); await fill();
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
  await click('Feedback'); await click('File report on GitHub');
  expect(document.body.textContent).toContain('Title and detailed description are required');
  expect(feedbackApi.file).not.toHaveBeenCalled();
  await fill();
  expect(document.querySelector('[aria-label="GitHub summary preview"]')?.textContent).not.toMatch(/private|hidden/);
  await click('Remove screenshot'); await click('Remove diagnostics'); await click('File report on GitHub');
  expect(document.querySelector('fieldset')?.disabled).toBe(true);
  await click('Close'); await click('Feedback');
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
  await queue();
  expect(document.body.textContent).toContain('captured-lane');
  expect(document.querySelector('a')?.href).toContain('/issues/999');
  await click('Close'); await queue();
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

it('keeps an unknown payload locked, even after a later conflict, until the queue confirms the saved ID', async () => {
  vi.spyOn(feedbackApi, 'file').mockRejectedValueOnce(new FeedbackError(null)).mockRejectedValue(new FeedbackError(409));
  await click('Feedback'); await fill(); await click('File report on GitHub');
  const first = vi.mocked(feedbackApi.file).mock.calls[0][0];
  expect(button('Recapture').disabled).toBe(true);
  await click('Retry same report');
  expect(button('Recapture').disabled).toBe(true);
  expect(vi.mocked(feedbackApi.file).mock.calls[1][0]).toBe(first);
  await click('Review batches');
  expect(document.body.textContent).toContain('No saved record confirmed');
  expect(document.body.textContent).not.toContain('Use saved report');
  listing.reports = [{ ...report, id: first.id }];
  await click('Refresh status'); await click('Use saved report');
  expect(document.body.textContent).not.toContain('Locked report:');
  expect(captureFeedback).toHaveBeenCalledTimes(1);
  expect(feedbackApi.dispatch).not.toHaveBeenCalled();
});

it('shows uncertain filing, submitted vs delivered, and needs-routing with explicit retries only', async () => {
  listing.reports = [{ ...report, status: 'filing_uncertain', error: 'Timeout token=private' }];
  listing.batches = [
    { id: 'b1', report_ids: ['r1'], status: 'submitted', destination: 'lane', error: null },
    { id: 'b2', report_ids: [], status: 'needs-routing', destination: 'missing', error: 'No target configured' },
  ];
  await queue();
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
  await queue();
  expect(document.body.textContent).toContain('Pending GitHub filing');
  await act(async () => { root.unmount(); root = createRoot(host); root.render(<FeedbackEntry />); });
  expect(button('Queue (1)')).toBeDefined();
  await queue();
  expect(document.body.textContent).toContain('Report one');
  expect(document.body.textContent).toContain('Pending GitHub filing');
  expect(feedbackApi.dispatch).not.toHaveBeenCalled();
});

it('blocks playback keyboard handlers, supports Escape, and keeps a closed draft', async () => {
  const shortcut = vi.fn();
  document.addEventListener('keydown', shortcut, true);
  try {
    await click('Feedback'); await fill();
    act(() => { document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(shortcut).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.querySelector('dialog')).toBeNull();
    await click('Feedback');
    expect(document.querySelector('textarea')?.value).toContain('Details');
    expect(feedbackApi.dispatch).not.toHaveBeenCalled();
  } finally { document.removeEventListener('keydown', shortcut, true); }
});

it('offers crash reporting without DeckProvider or QueryClient', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Bomb(): never { throw new Error('render broke'); }
  act(() => root.render(<RootErrorBoundary><Bomb /></RootErrorBoundary>));
  await click('Feedback');
  const readers = vi.mocked(captureFeedback).mock.calls.at(-1)![0]!;
  expect(readers.crash!()).toMatchObject({ message: 'render broke' });
  expect(document.body.textContent).toContain('File a report');
});

it.each(['form', 'queue'])('releases pre-held cue/pad through the %s without accepting newly typed controls', async (page) => {
  await act(async () => root.render(<><DeckKeys /><FeedbackEntry /></>));
  const key = (type: string, value: string, target: EventTarget = document) => act(() => {
    target.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true }));
  });
  key('keydown', 'z'); key('keydown', 'f');
  expect(hotCues.down).toHaveBeenCalledTimes(1);
  expect(engine.cueDown).toHaveBeenCalledTimes(1);
  if (page === 'form') await click('Feedback'); else await queue();
  expect(engine.cueUp).not.toHaveBeenCalled();
  const target = document.querySelector('textarea') ?? button('Close');
  key('keyup', 'z', target); key('keyup', 'f', target);
  expect(hotCues.up).toHaveBeenCalledTimes(1);
  expect(engine.cueUp).toHaveBeenCalledTimes(1);
  for (const value of ['z', 'f', 'd']) { key('keydown', value, target); key('keyup', value, target); }
  expect(hotCues.down).toHaveBeenCalledTimes(1);
  expect(hotCues.up).toHaveBeenCalledTimes(1);
  expect(engine.cueDown).toHaveBeenCalledTimes(1);
  expect(engine.cueUp).toHaveBeenCalledTimes(1);
  expect(engine.togglePlay).not.toHaveBeenCalled();
  key('keydown', 'f', target);
  key('keydown', 'd', target);
  await click('Close');
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', repeat: true, bubbles: true, cancelable: true })));
  key('keyup', 'f');
  key('keyup', 'd');
  expect(engine.cueUp).toHaveBeenCalledTimes(1);
  expect(engine.togglePlay).not.toHaveBeenCalled();
});

it('recaptures a definite stale conflict before showing the form, retaining text and kind with a fresh UUID', async () => {
  vi.spyOn(feedbackApi, 'file').mockRejectedValueOnce(new FeedbackError(409)).mockResolvedValue(report);
  await click('Feedback'); await feature(); await fill(); await click('File report on GitHub');
  const first = vi.mocked(feedbackApi.file).mock.calls[0][0];
  expect(document.body.textContent).toContain('captured origin may be stale');
  expect(button('Recapture').disabled).toBe(false);
  const next = { ...capture, context: { ...context, origin: { ...origin, revision: 'new-revision' } }, snapshot: { view: 'routine' } };
  let resolve!: (value: Capture) => void;
  vi.mocked(captureFeedback).mockImplementation(() => {
    expect(document.querySelector('dialog')).toBeNull();
    return new Promise((r) => { resolve = r; });
  });
  await click('Recapture');
  expect(document.querySelector('dialog')).toBeNull();
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(captureFeedback).toHaveBeenCalledTimes(2);
  await act(async () => resolve(next));
  expect(document.querySelector('select')?.value).toBe('feature');
  expect(document.querySelector('textarea')?.value).toContain('Details');
  await click('File report on GitHub');
  const second = vi.mocked(feedbackApi.file).mock.calls[1][0];
  expect(second.id).not.toBe(first.id);
  expect(second).toMatchObject({ kind: first.kind, title: first.title, description: first.description,
    origin: next.context.origin, snapshot: next.snapshot });
});

it('reopens a text-preserving fallback when recapture itself fails', async () => {
  await click('Feedback'); await feature(); await fill();
  vi.mocked(captureFeedback).mockRejectedValue(new Error('capture unavailable'));
  await click('Recapture');
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(document.querySelector('dialog')?.open).toBe(true);
  expect(document.querySelector('textarea')?.value).toContain('Details');
  expect(document.querySelector('select')?.value).toBe('feature');
  expect(document.body.textContent).toContain('Capture failed');
  expect(button('Retry context')).toBeDefined();
});

it('shows a globally polled pending count without opening any overlay or mutating reports', async () => {
  vi.useFakeTimers();
  listing.reports = [report, { ...report, id: 'failed', status: 'filing_failed' }, { ...report, id: 'sent', batch_id: 'b1' }];
  // Re-arm the global poll under fake timers.
  await act(async () => { root.unmount(); root = createRoot(host); root.render(<FeedbackEntry />); });
  expect(button('Queue (2)')).toBeDefined();
  listing.reports.push({ ...report, id: 'pending', status: 'pending' });
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(button('Queue (3)')).toBeDefined();
  expect(document.querySelector('dialog')).toBeNull();
  expect(captureFeedback).not.toHaveBeenCalled();
  expect(feedbackApi.dispatch).not.toHaveBeenCalled();
  expect(feedbackApi.retryReport).not.toHaveBeenCalled();
  expect(feedbackApi.retryBatch).not.toHaveBeenCalled();
});

it('keeps text editable after a definite attachment rejection, but never unlocks an earlier unknown submission', async () => {
  vi.spyOn(feedbackApi, 'file').mockRejectedValue(new FeedbackError(422));
  await click('Feedback'); await fill(); await click('File report on GitHub');
  expect(document.querySelector('fieldset')?.disabled).toBe(false);
  expect(document.querySelector('textarea')?.value).toContain('Details');
  expect(button('Recapture').disabled).toBe(false);
  await click('Remove screenshot');
  vi.mocked(feedbackApi.file).mockRejectedValueOnce(new FeedbackError(null)).mockRejectedValue(new FeedbackError(422));
  await click('File report on GitHub'); await click('Retry same report');
  expect(document.querySelector('fieldset')?.disabled).toBe(true);
  expect(button('Recapture').disabled).toBe(true);
});

it('uses the toolbar recipe only for entry controls and shows their open state', async () => {
  await act(async () => root.render(<FeedbackEntry toolbar />));
  expect(button('Feedback').classList.contains('btn-toolbar')).toBe(true);
  await click('Feedback');
  expect(button('Feedback').getAttribute('aria-expanded')).toBe('true');
  expect(button('Feedback').classList.contains('btn-selected')).toBe(true);
  expect(button('File report on GitHub').classList.contains('btn-toolbar')).toBe(false);
  expect(button('File report on GitHub').closest('.feedback-footer')).not.toBeNull();
  expect(document.querySelector('.feedback-body .feedback-footer')).toBeNull();
  await click('Close');
  expect(button('Feedback').getAttribute('aria-expanded')).toBe('false');
});

it('dismisses only backdrop clicks and preserves the draft without dispatch', async () => {
  await click('Feedback'); await fill();
  const dialog = document.querySelector('dialog')!;
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 700, bottom: 600 } as DOMRect);
  act(() => dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 200 })));
  expect(document.querySelector('dialog')).not.toBeNull();
  act(() => dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 })));
  expect(document.querySelector('dialog')).toBeNull();
  await click('Feedback');
  expect(document.querySelector('textarea')?.value).toContain('Details');
  expect(feedbackApi.dispatch).not.toHaveBeenCalled();
});
