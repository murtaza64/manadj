/** /api/spotify client (#347): connection status, Client ID, PKCE connect. */
import { BACKEND_URL, detailToMessage } from '../../api/client';

export type SpotifyState = 'no_client' | 'disconnected' | 'connected' | 'reconnect';

export interface SpotifyStatus {
  state: SpotifyState;
  client_id: string | null;
  /** What to register in the Spotify dashboard (fixed loopback port). */
  redirect_uri: string;
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

/** System browser under Electron (keeps the user's Spotify session); a new tab otherwise. */
export function openInBrowser(url: string): void {
  const bridge = window.manadjSettings;
  if (bridge?.openExternal) void bridge.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

// -- feeds (#347; browsed from Sync → Acquisition, gh#342) -------------------

export interface SpotifyFeed {
  id: string;
  kind: 'liked' | 'playlist';
  name: string;
  track_count: number;
  /** false = a playlist whose contents Spotify Dev Mode will not return */
  readable: boolean;
  url: string | null;
  image_url: string | null;
  owner: string | null;
  /** newest added_at sampled from the feed's last page (sort by activity) */
  last_added_at: string | null;
}

export interface SpotifyLibraryMatch {
  track_id: number;
  title: string | null;
  artist: string | null;
  duration_secs: number | null;
  score: number | null;
  confidence: 'match' | 'probable';
  /** true when a confirmed/proposed Source Correspondence already exists */
  linked: boolean;
}

export interface SpotifyFeedRow {
  spotify_id: string;
  title: string;
  artists: string[];
  album: string | null;
  duration_ms: number;
  url: string;
  isrc: string | null;
  added_at: string | null;
  library: SpotifyLibraryMatch | null;
  source_item: import('../../types').SourceItem | null;
}

/** open = not in the library and not wanted; wanted = a Source Item; library = matched/fulfilled */
export type SpotifyFeedStatus = 'all' | 'open' | 'wanted' | 'library';

export interface SpotifyFeedPage {
  feed: SpotifyFeed | null;
  feed_id: string;
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  /** Spotify's own count (incl. rows manadj drops) */
  feed_total: number;
  /** category sizes over the whole (text-filtered) feed */
  counts: Record<SpotifyFeedStatus, number>;
  rows: SpotifyFeedRow[];
}

export const SPOTIFY_FEEDS_KEY = ['spotifyFeeds'] as const;

export const spotifyFeedsApi = {
  feeds: (fresh = false) => call<SpotifyFeed[]>(fresh ? '/feeds?fresh=true' : '/feeds'),
  /** Server-side sort/filter over the whole cached feed (limit ≤ 500). */
  page: (
    feedId: string,
    offset = 0,
    limit = 100,
    sort: 'feed' | 'added' | 'title' | 'artist' | 'length' = 'feed',
    dir: 'asc' | 'desc' = 'asc',
    q = '',
    status: SpotifyFeedStatus = 'all',
  ) =>
    call<SpotifyFeedPage>(
      `/feeds/${encodeURIComponent(feedId)}?offset=${offset}&limit=${limit}&sort=${sort}&dir=${dir}&q=${encodeURIComponent(q)}&status=${status}`,
    ),
  /** Mark wanted. `rejectTrackId`: "that library match is wrong" — the
   * correspondence to it is rejected so the item stays acquirable. */
  want: async (spotifyId: string, rejectTrackId?: number): Promise<import('../../types').SourceItem & { created: boolean }> => {
    const res = await fetch(`${BACKEND_URL}/api/acquisition/want`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'spotify', external_id: spotifyId, reject_track_id: rejectTrackId ?? null }),
    });
    if (!res.ok) {
      let detail: unknown = null;
      try {
        detail = (await res.json()).detail;
      } catch {
        /* non-JSON */
      }
      throw new Error(detailToMessage(detail, `want failed (${res.status})`));
    }
    return res.json();
  },
};
