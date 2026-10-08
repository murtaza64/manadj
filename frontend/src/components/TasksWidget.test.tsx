// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { TasksWidget } from './TasksWidget';
import { TASKS_ACTIVE_POLL_MS, TASKS_IDLE_POLL_MS, taskSummaryPollMs } from './taskPolling';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('taskSummaryPollMs', () => {
  it('polls quickly only while work is active', () => {
    expect(taskSummaryPollMs(undefined)).toBe(TASKS_IDLE_POLL_MS);
    expect(taskSummaryPollMs({ counts: { pending: 1, running: 0, done: 0, failed: 0 }, attention: 0, attention_by_type: {}, running: [], pending_by_type: {}, undismissed_failures: 0 })).toBe(TASKS_ACTIVE_POLL_MS);
  });
});

const RUNNING = {
  id: 7, type: 'download', type_label: 'SoundCloud download', fix: 'acquisition', ref: 'source_item:2',
  subject: { kind: 'source_item', id: '2', label: 'Wake Up', detail: 'Hoax' }, state: 'running', error: null,
  attempts: 0, progress: 0.4, progress_label: '3.6 / 9.0 MB', superseded: false, not_before: null,
  created_at: null, started_at: null, finished_at: null, dismissed_at: null,
};
const SUMMARY = {
  counts: { pending: 4, running: 1, done: 20, failed: 3 },
  attention: 2, attention_by_type: { 'SoundCloud download': 2 }, running: [RUNNING],
  pending_by_type: { Waveform: 4 }, undismissed_failures: 3,
};

it('renders active queue depth, the current progress sliver and the attention badge', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(SUMMARY), { status: 200 }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['tasks', 'summary'], SUMMARY);

  act(() => {
    root.render(<QueryClientProvider client={client}><TasksWidget /></QueryClientProvider>);
  });

  expect(host.textContent).toContain('1 running · 4 queued');
  expect(host.querySelector('[aria-label="2 need attention"]')).not.toBeNull();
  expect((host.querySelector('.tasks-sliver span') as HTMLElement).style.width).toBe('40%');
  // the badge's tooltip names the subject, never a raw ref
  expect(host.querySelector('.tasks-widget')?.getAttribute('title')).toBe('SoundCloud download: Hoax - Wake Up · 3.6 / 9.0 MB');
  await api.tasks.summary();
  expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8127/api/tasks/summary');
  act(() => root.unmount());
});
