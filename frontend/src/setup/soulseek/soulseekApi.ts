/** /api/soulseek client (setup-guides #291): managed slskd status + credentials. */
import { BACKEND_URL, detailToMessage } from '../../api/client';

export interface SoulseekStatus {
  mode: 'external' | 'managed' | 'unconfigured';
  binary_available: boolean;
  username: string | null;
  process: 'stopped' | 'starting' | 'running' | 'crashed' | null;
  server: { connected: boolean; logged_in: boolean; connecting: boolean; state: string } | null;
  issue: string | null;
  web_url: string | null;
  licence: { name: string; version: string; license: string; source_url: string };
}

const BASE = `${BACKEND_URL}/api/soulseek`;

async function call(path: string, init?: RequestInit): Promise<SoulseekStatus> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detailToMessage(detail, `Soulseek request failed (${res.status})`));
  }
  return res.json();
}

export const soulseekApi = {
  status: () => call('/status'),
  connect: (username: string, password: string) =>
    call('/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  disconnect: () => call('/credentials', { method: 'DELETE' }),
  restart: () => call('/restart', { method: 'POST' }),
};

/** One-line connection state for the guide and status readouts. */
export type Connection = 'external' | 'off' | 'unavailable' | 'starting' | 'connecting' | 'connected' | 'failed';

export function connectionOf(s: SoulseekStatus): Connection {
  if (s.mode === 'external') return 'external';
  if (s.mode === 'unconfigured') return s.binary_available ? 'off' : 'unavailable';
  if (s.process === 'crashed' || s.process === 'stopped') return 'failed';
  if (s.server?.logged_in) return 'connected';
  if (s.issue && !s.server?.connecting) return 'failed';
  return s.process === 'starting' ? 'starting' : 'connecting';
}
