/** /api/spotify client (#347): connection status, Client ID, PKCE connect. */
import { BACKEND_URL, detailToMessage } from '../../api/client';

export type SpotifyState = 'no_client' | 'disconnected' | 'connected' | 'reconnect';

export interface SpotifyStatus {
  state: SpotifyState;
  client_id: string | null;
  /** What to register in the Spotify dashboard (loopback, any port). */
  redirect_uri: string;
  /** This backend's exact callback, if Spotify refuses the portless one. */
  redirect_uri_exact: string;
  scopes: string[];
  account: { id: string; display_name: string } | null;
  error: string | null;
}

export const SPOTIFY_STATUS_KEY = ['spotifyStatus'] as const;

const BASE = `${BACKEND_URL}/api/spotify`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detailToMessage(detail, `Spotify request failed (${res.status})`));
  }
  return res.json();
}

export const spotifyApi = {
  status: () => call<SpotifyStatus>('/status'),
  setClientId: (clientId: string) =>
    call<SpotifyStatus>('/client', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
    }),
  forgetClient: () => call<SpotifyStatus>('/client', { method: 'DELETE' }),
  connect: () => call<{ authorize_url: string; redirect_uri: string }>('/connect', { method: 'POST' }),
  disconnect: () => call<SpotifyStatus>('/token', { method: 'DELETE' }),
};
