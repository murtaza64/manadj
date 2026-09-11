import { recordError, type Snapshot } from './diagnostics';

export type Kind = 'bug' | 'feature';
export interface Origin { lane: string | null; owner: string | null; revision: string | null }
export interface Context { origin: Origin; destination: string }
export interface Report extends Context {
  id: string; kind: Kind; title: string; description: string;
  status: 'pending' | 'filing' | 'filed' | 'filing_failed' | 'filing_uncertain';
  issue_url: string | null; error: string | null; batch_id: string | null; created_at: string;
}
export interface Batch {
  id: string; report_ids: string[]; status: 'queued' | 'submitted' | 'delivered' | 'needs-routing';
  destination: string; error: string | null;
}
export interface Reports extends Context { reports: Report[]; batches: Batch[] }
export interface Payload {
  id: string; kind: Kind; title: string; description: string; origin: Origin;
  snapshot: Snapshot; screenshot: string | null; capture_warnings: string[];
}

const BASE = `${(import.meta.env.VITE_API_URL || 'http://localhost:8127').replace(/\/$/, '')}/api/feedback`;
export class FeedbackError extends Error {
  readonly status: number | null;
  constructor(status: number | null, timedOut = false) {
    super(status === 409
      ? 'Feedback conflict: the captured origin may be stale or the report ID may already exist. Review the queue, then recapture if this submission was rejected.'
      : status !== null ? `Feedback service returned HTTP ${status}. Retry when available.`
        : `Feedback request ${timedOut ? 'timed out' : 'failed'}. The server may have saved it; retry uses the same report ID.`);
    this.name = 'FeedbackError';
    this.status = status;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Manadj-Feedback': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    // Do not echo server detail strings: they can contain paths or credentials.
    if (!response.ok) throw new FeedbackError(response.status);
    return await response.json() as T;
  } catch (error) {
    recordError('feedback API', error);
    throw error instanceof FeedbackError ? error : new FeedbackError(null, controller.signal.aborted);
  } finally { window.clearTimeout(timer); }
}

export const feedbackApi = {
  context: () => request<Context>('/context'),
  reports: () => request<Reports>('/reports'),
  file: (payload: Payload) => request<Report>('/reports', payload),
  retryReport: (id: string) => request<Report>(`/reports/${encodeURIComponent(id)}/retry`, {}),
  dispatch: (report_ids: string[]) => request<Batch>('/dispatch', { report_ids }),
  retryBatch: (id: string) => request<Batch>(`/batches/${encodeURIComponent(id)}/retry`, {}),
};
