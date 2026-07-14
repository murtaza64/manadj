import type { TaskSummary } from '../types';

export const TASKS_ACTIVE_POLL_MS = 2000;
export const TASKS_IDLE_POLL_MS = 15000;

export function taskSummaryPollMs(summary: TaskSummary | undefined): number {
  return summary && (summary.counts.pending > 0 || summary.counts.running > 0)
    ? TASKS_ACTIVE_POLL_MS
    : TASKS_IDLE_POLL_MS;
}
