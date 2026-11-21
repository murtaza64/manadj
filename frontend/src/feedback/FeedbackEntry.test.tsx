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
const pointerMock = vi.hoisted(() => ({ pickElement: vi.fn() }));
vi.mock('./pointer', async (original) => ({ ...await original<typeof import('./pointer')>(), pickElement: pointerMock.pickElement }));
// jsdom cannot decode Image/canvas 2d; the bake is covered in annotate.test.ts.
const annotateMock = vi.hoisted(() => ({
  compositeScreenshot: vi.fn<(base: string, strokes: unknown[], pointer: unknown, viewport?: unknown) => Promise<string>>(async (base) => base),
}));
vi.mock('./annotate', async (original) => ({ ...await original<typeof import('./annotate')>(), compositeScreenshot: annotateMock.compositeScreenshot }));
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
// Feedback opens the capture overlay; the form follows Done + capture.
async function openForm() {
  await click('Feedback');
  await click('Done');
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(document.querySelector('dialog')?.open, 'report form').toBe(true);
}
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

it('opens the overlay before any capture; the form opens only after capture settles; deduplicates clicks', async () => {
  let resolve!: (value: Capture) => void;
  vi.mocked(captureFeedback).mockReturnValue(new Promise((r) => { resolve = r; }));
  await click('Feedback');
  expect(document.querySelector('.feedback-overlay')).not.toBeNull();
  expect(document.querySelector('dialog')).toBeNull();
  expect(captureFeedback).not.toHaveBeenCalled();
  await click('Done');
  expect(document.querySelector('.feedback-overlay')).toBeNull();
  expect(document.querySelector('dialog')).toBeNull();
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(captureFeedback).toHaveBeenCalledTimes(1);
  expect(document.querySelector('dialog')).toBeNull();
  act(() => button('Capturing...').click());
  expect(captureFeedback).toHaveBeenCalledTimes(1);
  await act(async () => resolve(structuredClone(capture)));
  expect(document.querySelector('dialog')?.open).toBe(true);
  expect(document.body.textContent).toContain('File a report');
});

it('permits failure fallback and context retry without recapturing or losing form text', async () => {
  vi.mocked(captureFeedback).mockResolvedValue({ ...capture, context: null, screenshot: null, warnings: ['Screenshot unavailable'] });
  await openForm(); await feature(); await fill();
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
  await openForm(); await click('File report on GitHub');
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
  await openForm(); await fill(); await click('File report on GitHub');
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
    await openForm(); await fill();
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
  await click('Done');
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
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
  if (page === 'form') await openForm(); else await queue();
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
  await openForm(); await feature(); await fill(); await click('File report on GitHub');
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
  await openForm(); await feature(); await fill();
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
  await openForm(); await fill(); await click('File report on GitHub');
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
  await click('Done');
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(button('File report on GitHub').classList.contains('btn-toolbar')).toBe(false);
  expect(button('File report on GitHub').closest('.feedback-footer')).not.toBeNull();
  expect(document.querySelector('.feedback-body .feedback-footer')).toBeNull();
  await click('Close');
  expect(button('Feedback').getAttribute('aria-expanded')).toBe('false');
});

it('dismisses only backdrop clicks and preserves the draft without dispatch', async () => {
  await openForm(); await fill();
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

it('hints at the captured view, playback state and recent activity trail', async () => {
  vi.mocked(captureFeedback).mockResolvedValue({ ...capture, snapshot: {
    view: 'performance',
    decks: [{ id: 'A', playing: true }, { id: 'B', playing: false }],
    errors: [{ at: '2026-11-20T12:00:00Z', source: 'window.error', message: 'boom' }],
    trail: [
      { at: '2026-11-20T11:59:58Z', event: 'view', detail: 'library' },
      { at: '2026-11-20T12:00:01Z', event: 'play', detail: 'deck A' },
    ],
  } });
  await openForm();
  expect(document.body.textContent).toContain('Captured: performance · A playing · 1 recent error · 2 recent events');
  expect(document.body.textContent).toContain('Recent activity');
  expect(document.body.textContent).toContain('view, library');
  expect(document.body.textContent).toContain('play, deck A');
});

it('points at an element, shows a removable chip and files the descriptor in the snapshot', async () => {
  pointerMock.pickElement.mockResolvedValue({
    tag: 'button', id: 'play', role: null, label: 'Play deck A', text: null,
    rect: { x: 10, y: 20, width: 64, height: 32 },
  });
  vi.mocked(captureFeedback).mockResolvedValue({ ...capture, screenshot: null });
  const payloads: Payload[] = [];
  vi.spyOn(feedbackApi, 'file').mockImplementation(async (payload) => {
    payloads.push(payload);
    return { ...report, id: payload.id };
  });
  await click('Feedback');
  expect(document.querySelector('dialog')).toBeNull();
  await click('Point');
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  expect(pointerMock.pickElement).toHaveBeenCalledTimes(1);
  // The chip shows on the overlay bar before the form ever opens.
  expect(document.querySelector('.feedback-bar')?.textContent).toContain('Element: button#play "Play deck A"');
  await click('Done');
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  expect(document.body.textContent).toContain('Element: button#play "Play deck A"');
  await fill();
  await click('File report on GitHub');
  expect(payloads).toHaveLength(1);
  expect(payloads[0].snapshot.pointer).toMatchObject({ tag: 'button', id: 'play', rect: { x: 10, y: 20, width: 64, height: 32 } });
  expect(payloads[0].screenshot).toBeNull();

  await click('Feedback');
  expect(document.body.textContent).not.toContain('Element: button#play');
  await click('Cancel');
});

it('cancelling the element pick keeps the draft and adds nothing', async () => {
  pointerMock.pickElement.mockResolvedValue(null);
  await openForm(); await fill();
  await click('Point at element');
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  expect(pointerMock.pickElement).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain('Element:');
  expect(document.querySelector('textarea')?.value).toContain('Details');
});

it('cancelling the overlay captures nothing and discards the session', async () => {
  pointerMock.pickElement.mockResolvedValue({
    tag: 'button', id: 'play', role: null, label: 'Play deck A', text: null,
    rect: { x: 10, y: 20, width: 64, height: 32 },
  });
  await click('Feedback');
  await click('Point');
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  expect(document.querySelector('.feedback-bar')?.textContent).toContain('Element: button#play');
  await click('Cancel');
  expect(document.querySelector('.feedback-overlay')).toBeNull();
  expect(captureFeedback).not.toHaveBeenCalled();
  expect(document.querySelector('dialog')).toBeNull();
  await click('Feedback');
  expect(document.body.textContent).not.toContain('Element: button#play');
  await click('Cancel');
});

it('cancels the overlay with Escape without touching the app draft state', async () => {
  await click('Feedback');
  expect(document.querySelector('.feedback-overlay')).not.toBeNull();
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(document.querySelector('.feedback-overlay')).toBeNull();
  expect(captureFeedback).not.toHaveBeenCalled();
});

it('draws full-screen strokes in the overlay and bakes them at filing', async () => {
  await click('Feedback');
  // Drawing is active by default: pen row visible, nothing to undo yet.
  expect(button('Undo').disabled).toBe(true);
  expect(button('Clear').disabled).toBe(true);
  const canvas = document.querySelector('.feedback-overlay-canvas')!;
  const stroke = (type: string, x: number, y: number) => act(() => {
    canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  });
  stroke('pointerdown', 10, 10); stroke('pointermove', 40, 40); stroke('pointerup', 40, 40);
  expect(button('Undo').disabled).toBe(false);
  await click('Undo');
  expect(button('Undo').disabled).toBe(true);
  stroke('pointerdown', 10, 10); stroke('pointerup', 60, 60);
  await click('Done');
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  await fill();
  const payloads: Payload[] = [];
  vi.spyOn(feedbackApi, 'file').mockImplementation(async (payload) => {
    payloads.push(payload);
    return { ...report, id: payload.id };
  });
  await click('File report on GitHub');
  expect(annotateMock.compositeScreenshot).toHaveBeenCalledTimes(1);
  expect(annotateMock.compositeScreenshot.mock.calls[0][1]).toHaveLength(1);
  expect(payloads[0].screenshot).toBe(capture.screenshot);
});

it('offers draw controls on the screenshot with undo and clear', async () => {
  await openForm();
  await click('Draw');
  expect(button('Done drawing')).toBeDefined();
  expect(button('Undo').disabled).toBe(true);
  expect(button('Clear').disabled).toBe(true);
  await click('Done drawing');
  await click('Remove screenshot');
  expect(document.querySelector('input[type=file]')).not.toBeNull();
});

it('dictates editable draft text into the title only after an explicit start', async () => {
  interface FakeRecognition {
    onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    started: number;
  }
  const instances: FakeRecognition[] = [];
  vi.stubGlobal('SpeechRecognition', class {
    onresult: FakeRecognition['onresult'] = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    continuous = false; interimResults = true; lang = '';
    started = 0;
    constructor() { instances.push(this as FakeRecognition); }
    start() { this.started += 1; }
    stop() { this.onend?.(); }
  });
  await openForm();
  // Disclosure is visible before the mic can start.
  expect(document.body.textContent).toContain('browser speech service');
  const dictateButtons = () => [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Dictate');
  expect(dictateButtons()).toHaveLength(2);
  await act(async () => { dictateButtons()[0].click(); });
  expect(instances).toHaveLength(1);
  expect(instances[0].started).toBe(1);
  await act(async () => {
    instances[0].onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: ' cue button sticks ' } }] });
  });
  expect(document.querySelector('input:not([type])')).toHaveProperty('value', 'cue button sticks');
  await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Stop dictation')!.click(); });
  expect(dictateButtons()).toHaveLength(2);
});

it('omits dictation controls when the runtime lacks speech recognition', async () => {
  await openForm();
  expect([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Dictate')).toHaveLength(0);
  expect(document.body.textContent).not.toContain('browser speech service');
});


it('stops recognition before in-flight filing and ignores late transcripts', async () => {
  let recognition!: { onresult: ((event: unknown) => void) | null; stop: () => void; onend: (() => void) | null };
  const stop = vi.fn();
  class FakeRecognition {
    continuous = false; interimResults = false; lang = '';
    onresult = null; onerror = null; onend: (() => void) | null = null;
    constructor() { recognition = this; }
    start() {}
    stop() { stop(); this.onend?.(); }
  }
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  await openForm(); await fill();
  const dictate = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Dictate')!;
  await act(async () => dictate.click());
  let finish!: (value: Report) => void;
  vi.spyOn(feedbackApi, 'file').mockImplementation(() => {
    expect(stop).toHaveBeenCalledTimes(1);
    return new Promise((resolve) => { finish = resolve; });
  });
  await click('File report on GitHub');
  const frozen = vi.mocked(feedbackApi.file).mock.calls[0][0];
  await act(async () => recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late text' } }] }));
  expect(document.querySelector('textarea')?.value).not.toContain('late text');
  expect(frozen.description).not.toContain('late text');
  await act(async () => finish(report));
});

it('clears viewport marks on resize and protects the active draft from boot reload', async () => {
  const file = vi.spyOn(feedbackApi, 'file');
  await click('Feedback');
  expect(document.documentElement.dataset.feedbackActive).toBe('true');
  const canvas = document.querySelector('.feedback-overlay-canvas')!;
  const stroke = (type: string, clientX: number, clientY: number) => {
    act(() => canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY })));
  };
  stroke('pointerdown', 10, 10); stroke('pointerup', 60, 60);
  expect(button('Undo').disabled).toBe(false);
  await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(button('Undo').disabled).toBe(true);
  expect(document.body.textContent).toContain('View changed. Marks cleared');
  await click('Cancel');
  expect(document.querySelector('.feedback-overlay')).toBeNull();
  expect(document.documentElement.dataset.feedbackActive).toBeUndefined();
  expect(captureFeedback).not.toHaveBeenCalled();
  expect(file).not.toHaveBeenCalled();
});

it('excludes capture chrome from fallback screenshots and cancels safely with Escape', async () => {
  await click('Feedback');
  expect(document.querySelector('.feedback-overlay')?.hasAttribute('data-feedback-private')).toBe(true);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('.feedback-overlay')).toBeNull();
  expect(captureFeedback).not.toHaveBeenCalled();
});
