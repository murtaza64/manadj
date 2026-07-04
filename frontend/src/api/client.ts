import type {
  PlaylistTrackAdd,
  PlaylistTrackAddResult,
  UnifiedPlaylist,
  PlaylistSyncStats,
  UnifiedTagView,
  TagSyncStats,
  TagSyncRequest,
  SyncResult,
  SyncPlaylistRequest,
  TrackSyncResult,
  EngineRBXMLSyncRequest,
  EngineRBXMLSyncResult,
  RekordboxTrackSyncRequest,
  RekordboxTrackSyncResult,
  LibraryImportResult,
  LibraryImportRequest,
  LibraryImportExecutionResult,
  SourceItem,
  AcquisitionRefreshStats,
  Classification,
} from '../types';

/** Wire shape of a Transition template (mix-editor issues 03 + 28) —
 * snake_case recipe columns (alignment rule + window); `lanes` stays the
 * client's opaque payload. */
export interface TransitionTemplateWire {
  uuid: string;
  name: string;
  align_a_base: string;
  align_delta_beats: number;
  align_b_base: string;
  before_beats: number;
  after_beats: number;
  scalable: boolean;
  lanes: Record<string, unknown>;
}

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

    /** URL of a track's audio stream (for audio elements / direct fetch). */
    audioUrl: (id: number) => `${API_BASE}/tracks/${id}/audio`,

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
        sortColumn?: string | null;
        sortDirection?: 'asc' | 'desc';
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
        // Sort parameters
        if (filters.sortColumn) {
          params.append('sort_column', filters.sortColumn);
        }
        if (filters.sortDirection) {
          params.append('sort_direction', filters.sortDirection);
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
      bpm?: number;
      key?: number;
    }) => {
      const response = await fetch(`${API_BASE}/tracks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update track (${response.status}): ${errorText}`);
      }
      return response.json();
    },

    compareMetadata: async () => {
      const response = await fetch(`${API_BASE}/tracks/metadata/compare`);
      if (!response.ok) throw new Error('Failed to compare metadata');
      return response.json();
    },

    syncMetadata: async (request: {
      updates: Array<{
        track_id: number;
        fields: Record<string, string | number | null>;
      }>;
      dry_run: boolean;
    }) => {
      const response = await fetch(`${API_BASE}/tracks/metadata/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error('Failed to sync metadata');
      return response.json();
    },

    writeMetadataToFiles: async (request: {
      updates: Array<{
        track_id: number;
        fields: Record<string, string | number | null>;
      }>;
      dry_run: boolean;
    }) => {
      const response = await fetch(`${API_BASE}/tracks/metadata/write-to-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error('Failed to write metadata to files');
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
    /** Waveform data v2 blob (ADR 0014): binary, immutable once generated. */
    getData: async (trackId: number): Promise<ArrayBuffer> => {
      const response = await fetch(`${API_BASE}/waveforms/${trackId}/data`);
      if (!response.ok) {
        throw new Error(`Failed to fetch waveform data: ${response.statusText}`);
      }
      return response.arrayBuffer();
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

    delete: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/beatgrids/${trackId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to delete beatgrid: ${response.statusText}`);
      }
      return response.json();
    },
  },

  hotcues: {
    get: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/hotcues/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch hot cues: ${response.statusText}`);
      }
      return response.json();
    },

    set: async (trackId: number, slotNumber: number, data: {
      time_seconds: number;
      label?: string;
      color?: string;
    }) => {
      const response = await fetch(
        `${API_BASE}/hotcues/${trackId}/${slotNumber}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
      if (!response.ok) {
        throw new Error(`Failed to set hot cue: ${response.statusText}`);
      }
      return response.json();
    },

    delete: async (trackId: number, slotNumber: number) => {
      const response = await fetch(
        `${API_BASE}/hotcues/${trackId}/${slotNumber}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        throw new Error(`Failed to delete hot cue: ${response.statusText}`);
      }
      return response.json();
    },
  },

  analyze: {
    bpm: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/analyze/bpm/${trackId}`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`Failed to analyze BPM: ${response.statusText}`);
      }
      return response.json();
    },

    key: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/analyze/key/${trackId}`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`Failed to analyze key: ${response.statusText}`);
      }
      return response.json();
    },

    getBpm: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/analyze/bpm/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch BPM analysis: ${response.statusText}`);
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

    addTrack: async (playlistId: number, data: PlaylistTrackAdd): Promise<PlaylistTrackAddResult> => {
      const response = await fetch(`${API_BASE}/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return response.json();
    },

    removeTrack: async (playlistId: number, trackId: number) => {
      const response = await fetch(`${API_BASE}/playlists/${playlistId}/tracks/${trackId}`, {
        method: 'DELETE',
      });
      return response.json();
    },

    reorderTracks: async (playlistId: number, trackPositions: Array<{ track_id: number; position: number }>) => {
      const response = await fetch(`${API_BASE}/playlists/${playlistId}/reorder-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_positions: trackPositions }),
      });
      if (!response.ok) {
        throw new Error(`Reorder failed (${response.status})`);
      }
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

    syncEngineRBXML: async (request: EngineRBXMLSyncRequest): Promise<EngineRBXMLSyncResult> => {
      const res = await fetch(`${API_BASE}/sync/tracks/engine/sync-rbxml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to export Engine DJ RBXML');
      return res.json();
    },

    syncRekordbox: async (request: RekordboxTrackSyncRequest): Promise<RekordboxTrackSyncResult> => {
      const res = await fetch(`${API_BASE}/sync/tracks/rekordbox/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to sync tracks with Rekordbox');
      return res.json();
    },
  },

  syncPerformance: {
    /** Import Engine's hot cues onto one Library track. "fill-empty" never
     * touches existing slots; "replace-all" is the confirmed overwrite verb. */
    importHotcues: async (request: {
      track_id: number;
      mode: 'fill-empty' | 'replace-all';
    }): Promise<{ imported: number; skipped: number; deleted: number }> => {
      const res = await fetch(`${API_BASE}/sync/performance/hotcues/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to import hot cues from Engine DJ');
      return res.json();
    },

    /** Import Engine's Beatgrid (origin "imported"). "fill-empty" only lands
     * on absent/placeholder grids; "replace" is the confirmed overwrite. */
    importBeatgrid: async (request: {
      track_id: number;
      mode: 'fill-empty' | 'replace';
    }): Promise<{ imported: boolean; reason: string | null }> => {
      const res = await fetch(`${API_BASE}/sync/performance/beatgrid/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to import beatgrid from Engine DJ');
      return res.json();
    },

    /** Bulk import: the automatic tier fills blanks (cues/grid/main cue/key);
     * overwrites of saved info come back as pending items and only apply when
     * listed in `overwrites` on a follow-up call. */
    bulkImport: async (request: {
      track_ids: number[] | null;
      overwrites?: { track_id: number; field: string; mode?: 'fill-empty' | 'replace-all' }[];
    }): Promise<{
      scanned: number;
      matched: number;
      applied: { hotcues: number; beatgrid: number; maincue: number; key: number };
      pending: {
        track_id: number;
        title: string | null;
        artist: string | null;
        field: string;
        detail: string;
        variable: boolean | null;
      }[];
    }> => {
      const res = await fetch(`${API_BASE}/sync/performance/bulk-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to bulk-import performance data from Engine DJ');
      return res.json();
    },

    /** Import Engine's user-set Main cue through the normal cue persistence
     * path. "fill-empty" only when unset; "replace" is the confirmed overwrite. */
    importMaincue: async (request: {
      track_id: number;
      mode: 'fill-empty' | 'replace';
    }): Promise<{ imported: boolean; reason: string | null }> => {
      const res = await fetch(`${API_BASE}/sync/performance/maincue/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) throw new Error('Failed to import main cue from Engine DJ');
      return res.json();
    },
  },

  transitions: {
    /** All saved Transitions (boot load; ADR 0011). Ordered pair, position. */
    list: async (): Promise<
      {
        a_track_id: number;
        b_track_id: number;
        uuid: string;
        position: number;
        name: string;
        favorite: boolean;
        data: Record<string, unknown>;
      }[]
    > => {
      const res = await fetch(`${API_BASE}/transitions`);
      if (!res.ok) throw new Error('Failed to fetch transitions');
      return res.json();
    },

    /** Client-authoritative pair-replace: the server reconciles by uuid.
     * An empty items list deletes the pair. */
    replacePair: async (
      aTrackId: number,
      bTrackId: number,
      items: { uuid: string; name: string; favorite: boolean; data: Record<string, unknown> }[]
    ) => {
      const res = await fetch(`${API_BASE}/transitions/pair/${aTrackId}/${bTrackId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(`Failed to save transitions (${res.status})`);
      return res.json();
    },
  },

  libraryImport: {
    getCandidates: async (recursive: boolean = false): Promise<LibraryImportResult> => {
      const response = await fetch(`${API_BASE}/sync/library/candidates?recursive=${recursive}`);
      if (!response.ok) throw new Error('Failed to fetch import candidates');
      return response.json();
    },

    import: async (request: LibraryImportRequest): Promise<LibraryImportExecutionResult> => {
      const response = await fetch(`${API_BASE}/sync/library/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error('Failed to import tracks');
      return response.json();
    },
  },

  acquisition: {
    getItems: async (): Promise<SourceItem[]> => {
      const res = await fetch(`${API_BASE}/acquisition/items`);
      if (!res.ok) throw new Error('Failed to fetch source items');
      return res.json();
    },

    refresh: async (): Promise<AcquisitionRefreshStats> => {
      const res = await fetch(`${API_BASE}/acquisition/refresh`, { method: 'POST' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to refresh source items');
      }
      return res.json();
    },

    setClassification: async (itemId: number, classification: Classification): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/classification`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classification }),
      });
      if (!res.ok) throw new Error('Failed to set classification');
      return res.json();
    },

    acceptMatch: async (itemId: number): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/accept-match`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to accept match');
      return res.json();
    },

    rejectMatch: async (itemId: number): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/reject-match`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reject match');
      return res.json();
    },

    queueBulk: async (itemIds: number[]): Promise<{ queued: number; skipped: number }> => {
      const res = await fetch(`${API_BASE}/acquisition/items/queue-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      if (!res.ok) throw new Error('Failed to bulk queue');
      return res.json();
    },

    ignoreItem: async (itemId: number): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/ignore`, { method: 'POST' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to ignore item');
      }
      return res.json();
    },

    restoreItem: async (itemId: number): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/restore`, { method: 'POST' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to restore item');
      }
      return res.json();
    },

    setProvenance: async (itemId: number, audioFrom: string): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/provenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_from: audioFrom }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to set provenance');
      }
      return res.json();
    },

    queueDownload: async (itemId: number): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/queue`, { method: 'POST' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to queue download');
      }
      return res.json();
    },

    linkToTrack: async (itemId: number, trackId: number, audioFrom?: string): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId, audio_from: audioFrom || null }),
      });
      if (!res.ok) throw new Error('Failed to link track');
      return res.json();
    },
  },

  transitionTemplates: {
    /** All Transition templates, creation-ordered (mix-editor issue 03).
     * Plain CRUD — templates are explicit saves, unlike Transitions'
     * autosaved pair-replace. */
    list: async (): Promise<TransitionTemplateWire[]> => {
      const res = await fetch(`${API_BASE}/transition-templates`);
      if (!res.ok) throw new Error('Failed to fetch transition templates');
      return res.json();
    },

    create: async (template: TransitionTemplateWire): Promise<TransitionTemplateWire> => {
      const res = await fetch(`${API_BASE}/transition-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      if (!res.ok) throw new Error(`Failed to create transition template (${res.status})`);
      return res.json();
    },

    update: async (template: TransitionTemplateWire): Promise<TransitionTemplateWire> => {
      const res = await fetch(`${API_BASE}/transition-templates/${template.uuid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      if (!res.ok) throw new Error(`Failed to update transition template (${res.status})`);
      return res.json();
    },

    delete: async (uuid: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/transition-templates/${uuid}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Failed to delete transition template (${res.status})`);
    },
  },
};
