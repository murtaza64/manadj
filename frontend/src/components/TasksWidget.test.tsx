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
    expect(taskSummaryPollMs({ counts: { pending: 1, running: 0, done: 0, failed: 0 }, running_task: null, undismissed_failures: 0 })).toBe(TASKS_ACTIVE_POLL_MS);
  });
});

it('renders active queue depth and the failure badge', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    counts: { pending: 4, running: 1, done: 20, failed: 3 },
    running_task: { type: 'analysis', ref: 'track:2' },
    undismissed_failures: 3,
  }), { status: 200 }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['tasks', 'summary'], {
    counts: { pending: 4, running: 1, done: 20, failed: 3 },
    running_task: { type: 'analysis', ref: 'track:2' },
    undismissed_failures: 3,
  });

  act(() => {
    root.render(<QueryClientProvider client={client}><TasksWidget /></QueryClientProvider>);
  });

  expect(host.textContent).toContain('1 running / 4 pending');
  expect(host.querySelector('[aria-label="3 undismissed failures"]')).not.toBeNull();
  await api.tasks.summary();
  expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:8127/api/tasks/summary');
  act(() => root.unmount());
});
