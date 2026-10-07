/** /api/soundcloud client (setup-guides #290): connection status + token. */
import { useQuery } from '@tanstack/react-query';
import { BACKEND_URL, detailToMessage } from '../../api/client';

export interface SoundCloudStatus {
  connected: boolean;
  /** secrets = manaDJ's .env (what this guide writes); env = process environment; config = settings file */
  token_source: 'secrets' | 'env' | 'config' | null;
  account: { username: string; likes_count: number } | null;
  error: string | null;
}

export const SOUNDCLOUD_STATUS_KEY = ['soundcloudStatus'] as const;

const BASE = `${BACKEND_URL}/api/soundcloud`;

async function call(path: string, init?: RequestInit): Promise<SoundCloudStatus> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detailToMessage(detail, `SoundCloud request failed (${res.status})`));
  }
  return res.json();
}

export const soundcloudApi = {
  status: (fresh = false) => call(fresh ? '/status?fresh=true' : '/status'),
  connect: (token: string) =>
    call('/token', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  disconnect: () => call('/token', { method: 'DELETE' }),
};

/** Whether SoundCloud is connected (gates the Acquisition tab). */
export function useSoundCloudConnected(): boolean {
  const { data } = useQuery({
    queryKey: SOUNDCLOUD_STATUS_KEY,
    queryFn: () => soundcloudApi.status(),
    staleTime: 5 * 60 * 1000,
  });
  return data?.connected ?? false;
}
