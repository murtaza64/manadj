import type { PlaylistTrackAdd, UnifiedPlaylist, PlaylistSyncStats, UnifiedTagView, TagSyncStats, TagSyncRequest, SyncResult, SyncPlaylistRequest, TrackSyncResult } from '../types';

// Backend URL configuration - can be overridden with VITE_API_URL env var
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const API_BASE = `${BACKEND_URL}/api`;

// Export for use in other components (e.g., for static file URLs)
export { BACKEND_URL };

export const api = {
  tracks: {
    getById: async (id: number) => {
      const res = await fetch(`${API_BASE}/tracks/${id}`);
      if (!res.ok) throw new Error('Failed to fetch track');
      return res.json();
    },

    list: async (
      page: number = 1,
      perPage: number = 1000,
      filters?: {
        tagIds?: number[];
        search?: string;
        energyMin?: number;
        energyMax?: number;
        tagMatchMode?: 'ANY' | 'ALL';
        bpmCenter?: number | null;
        bpmThresholdPercent?: number | null;
        keyCamelotIds?: string[];
        unprocessed?: boolean;
      }
    ) => {
      const params = new URLSearchParams({
        page: page.toString(),
        per_page: perPage.toString(),
      });

      if (filters) {
        if (filters.tagIds && filters.tagIds.length > 0) {
          filters.tagIds.forEach(id => params.append('tag_ids', id.toString()));
        }
        if (filters.search) {
          params.append('search', filters.search);
        }
        if (filters.energyMin !== undefined) {
          params.append('energy_min', filters.energyMin.toString());
        }
        if (filters.energyMax !== undefined) {
          params.append('energy_max', filters.energyMax.toString());
        }
        if (filters.tagMatchMode) {
          params.append('tag_match_mode', filters.tagMatchMode);
        }
        // BPM filter
        if (filters.bpmCenter !== undefined && filters.bpmCenter !== null) {
          params.append('bpm_center', filters.bpmCenter.toString());
        }
        if (filters.bpmThresholdPercent !== undefined && filters.bpmThresholdPercent !== null) {
          params.append('bpm_threshold_percent', filters.bpmThresholdPercent.toString());
        }
        // Key filter (repeating parameter pattern like tags)
        if (filters.keyCamelotIds && filters.keyCamelotIds.length > 0) {
          filters.keyCamelotIds.forEach(id => params.append('key_camelot_ids', id));
        }
        // Unprocessed filter
        if (filters.unprocessed) {
          params.append('unprocessed', 'true');
        }
      }

      const response = await fetch(`${API_BASE}/tracks/?${params}`);
      return response.json();
    },

    get: async (id: number) => {
      const response = await fetch(`${API_BASE}/tracks/${id}`);
      return response.json();
    },

    update: async (id: number, data: {
      energy?: number;
      tag_ids?: number[];
      title?: string;
      artist?: string;
    }) => {
      const response = await fetch(`${API_BASE}/tracks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.json();
    },
  },

  tags: {
    listCategories: async () => {
      const response = await fetch(`${API_BASE}/tags/categories`);
      return response.json();
    },

    listByCategory: async (categoryId: number) => {
      const response = await fetch(`${API_BASE}/tags/categories/${categoryId}/tags`);
      return response.json();
    },

    listAll: async () => {
      const response = await fetch(`${API_BASE}/tags/`);
      return response.json();
    },

    create: async (tag: { name: string; category_id: number; color?: string; display_order?: number }) => {
      const response = await fetch(`${API_BASE}/tags/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tag),
      });
      return response.json();
    },

    update: async (id: number, data: { name?: string; color?: string; display_order?: number }) => {
      const response = await fetch(`${API_BASE}/tags/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.json();
    },

    delete: async (id: number) => {
      const response = await fetch(`${API_BASE}/tags/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete tag');
      }
    },

    reorder: async (tagOrder: Array<{id: number, display_order: number}>) => {
      const response = await fetch(`${API_BASE}/tags/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tagOrder),
      });
      return response.json();
    },
  },

  waveforms: {
    get: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/waveforms/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch waveform: ${response.statusText}`);
      }
      return response.json();
    },

    updateCuePoint: async (trackId: number, cuePointTime: number | null) => {
      const response = await fetch(`${API_BASE}/waveforms/${trackId}/cue-point`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cue_point_time: cuePointTime }),
      });
      return response.json();
    },
  },

  beatgrids: {
    get: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/beatgrids/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch beatgrid: ${response.statusText}`);
      }
      return response.json();
    },

    setDownbeat: async (trackId: number, downbeatTime: number) => {
      const response = await fetch(`${API_BASE}/beatgrids/${trackId}/set-downbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downbeat_time: downbeatTime }),
      });
      if (!response.ok) {
        throw new Error(`Failed to set downbeat: ${response.statusText}`);
      }
      return response.json();
    },

    nudge: async (trackId: number, offsetMs: number) => {
      const response = await fetch(`${API_BASE}/beatgrids/${trackId}/nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offset_ms: offsetMs }),
      });
      if (!response.ok) {
        throw new Error(`Failed to nudge beatgrid: ${response.statusText}`);
      }
      return response.json();
    },
  },

  playlists: {
    list: async () => {
      const response = await fetch(`${API_BASE}/playlists/`);
      return response.json();
    },

    get: async (id: number) => {
      const response = await fetch(`${API_BASE}/playlists/${id}`);
      return response.json();
    },

    create: async (playlist: { name: string; color?: string; display_order?: number }) => {
      const response = await fetch(`${API_BASE}/playlists/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playlist),
      });
      return response.json();
    },

    update: async (id: number, data: { name?: string; color?: string; display_order?: number }) => {
      const response = await fetch(`${API_BASE}/playlists/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.json();
    },

    delete: async (id: number) => {
      const response = await fetch(`${API_BASE}/playlists/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete playlist');
      }
    },

    addTrack: async (playlistId: number, data: PlaylistTrackAdd) => {
      const response = await fetch(`${API_BASE}/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.json();
    },

    removeTrack: async (playlistId: number, playlistTrackId: number) => {
      const response = await fetch(`${API_BASE}/playlists/${playlistId}/tracks/${playlistTrackId}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    reorderTracks: async (playlistId: number, trackPositions: Array<{ id: number; position: number }>) => {
      const response = await fetch(`${API_BASE}/playlists/${playlistId}/reorder-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_positions: trackPositions }),
      });
      return response.json();
    },

    reorder: async (playlistOrder: Array<{ id: number; display_order: number }>) => {
      const response = await fetch(`${API_BASE}/playlists/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playlistOrder),
      });
      return response.json();
    },
  },

  playlistSync: {
    getUnified: async (): Promise<UnifiedPlaylist[]> => {
      const res = await fetch(`${API_BASE}/sync/playlists/`);
      if (!res.ok) throw new Error('Failed to fetch unified playlists');
      return res.json();
    },

    getStats: async (): Promise<PlaylistSyncStats> => {
      const res = await fetch(`${API_BASE}/sync/playlists/stats`);
      if (!res.ok) throw new Error('Failed to fetch sync stats');
      return res.json();
    },

    sync: async (playlistName: string, request: SyncPlaylistRequest): Promise<SyncResult | SyncResult[]> => {
      const encodedName = encodeURIComponent(playlistName);
      const res = await fetch(`${API_BASE}/sync/playlists/${encodedName}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Failed to sync playlist');
      }
      return res.json();
    },
  },

  tagSync: {
    getUnified: async (): Promise<UnifiedTagView[]> => {
      const res = await fetch(`${API_BASE}/sync/tags/`);
      if (!res.ok) throw new Error('Failed to fetch unified tags');
      return res.json();
    },

    getStats: async (): Promise<TagSyncStats> => {
      const res = await fetch(`${API_BASE}/sync/tags/stats`);
      if (!res.ok) throw new Error('Failed to fetch tag sync stats');
      return res.json();
    },

    syncToEngine: async (req: TagSyncRequest): Promise<TagSyncStats> => {
      const res = await fetch(`${API_BASE}/sync/tags/sync/engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error('Failed to sync tags to Engine DJ');
      return res.json();
    },

    syncToRekordbox: async (req: TagSyncRequest): Promise<TagSyncStats> => {
      const res = await fetch(`${API_BASE}/sync/tags/sync/rekordbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error('Failed to sync tags to Rekordbox');
      return res.json();
    },
  },

  trackSync: {
    getEngineDiscrepancies: async (validateFiles: boolean = false): Promise<TrackSyncResult> => {
      const params = new URLSearchParams();
      if (validateFiles) params.append('validate_files', 'true');

      const res = await fetch(`${API_BASE}/sync/tracks/engine?${params}`);
      if (!res.ok) throw new Error('Failed to fetch Engine track discrepancies');
      return res.json();
    },

    getRekordboxDiscrepancies: async (validateFiles: boolean = false): Promise<TrackSyncResult> => {
      const params = new URLSearchParams();
      if (validateFiles) params.append('validate_files', 'true');

      const res = await fetch(`${API_BASE}/sync/tracks/rekordbox?${params}`);
      if (!res.ok) throw new Error('Failed to fetch Rekordbox track discrepancies');
      return res.json();
    },
  },
};
