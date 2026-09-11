import { recordError, redact, type Snapshot } from './diagnostics';

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
    if (!response.ok) throw new Error(`Feedback service returned HTTP ${response.status}. Retry when available.`);
    return await response.json() as T;
  } catch (error) {
    recordError('feedback API', error);
    throw new Error(controller.signal.aborted
      ? 'Feedback request timed out. The server may have saved it; retry uses the same report ID.'
      : redact(error instanceof Error ? error.message : 'Feedback service unavailable.'));
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
