import type {
  CaptureEvent as CaptureEventWire,
  DetectorParams as CaptureDetectorParams,
} from '../capture/events';
import type {
  HotCue,
  Playlist,
  Track,
  PlaylistTrackAdd,
  PlaylistTrackAddResult,
  UnifiedPlaylist,
  PlaylistSyncStats,
  PlaylistExportTarget,
  PlaylistFullExportPreview,
  PlaylistFullExportReport,
  UnifiedTagView,
  TagSyncStats,
  TagSyncRequest,
  SyncResult,
  SyncPlaylistRequest,
  TrackSyncResult,
  EngineTrackExportRequest,
  EngineTrackExportResult,
  RekordboxTrackSyncRequest,
  RekordboxTrackSyncResult,
  LibraryImportResult,
  LibraryImportRequest,
  LibraryImportExecutionResult,
  SourceItem,
  AcquisitionRefreshStats,
  Classification,
  SupplierInfo,
  SoulseekResult,
  SoulseekSearchResponse,
  AnalysisPendingItem,
  AnalysisTaskStatus,
  TaskRow,
  TaskState,
  TaskSummary,
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
const BACKEND_URL = import.meta.env.VITE_API_URL || 'http://localhost:8127';
const API_BASE = `${BACKEND_URL}/api`;

// Export for use in other components (e.g., for static file URLs)
export { BACKEND_URL };

export function detailToMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail || fallback;

  if (Array.isArray(detail)) {
    const messages = detail.flatMap(item => {
      if (typeof item === 'string') return [item];
      if (!item || typeof item !== 'object') return [];
      const message = (item as Record<string, unknown>).msg;
      return typeof message === 'string' ? [message] : [];
    });
    if (messages.length > 0) return messages.join('; ');
  }

  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const value = detail as Record<string, unknown>;
    const message = typeof value.message === 'string' ? value.message : '';
    const resultErrors = Array.isArray(value.results)
      ? value.results.flatMap(result => {
          if (!result || typeof result !== 'object') return [];
          const row = result as Record<string, unknown>;
          if (!row.error) return [];
          const error = typeof row.error === 'string' ? row.error : JSON.stringify(row.error);
          const target = typeof row.target === 'string' ? `${row.target}: ` : '';
          return [`${target}${error}`];
        })
      : [];
    if (message && resultErrors.length > 0) return `${message}: ${resultErrors.join('; ')}`;
    if (message) return message;
    if (resultErrors.length > 0) return resultErrors.join('; ');
  }

  try {
    return detail == null ? fallback : JSON.stringify(detail) || fallback;
  } catch {
    return fallback;
  }
}

export const api = {
  tasks: {
    summary: async (): Promise<TaskSummary> => {
      const response = await fetch(`${API_BASE}/tasks/summary`);
      if (!response.ok) throw new Error('Failed to fetch task summary');
      return response.json();
    },

    list: async (filters?: {
      state?: TaskState;
      type?: string;
      limit?: number;
    }): Promise<TaskRow[]> => {
      const params = new URLSearchParams();
      if (filters?.state) params.set('state', filters.state);
      if (filters?.type) params.set('type', filters.type);
      if (filters?.limit) params.set('limit', String(filters.limit));
      const query = params.size ? `?${params}` : '';
      const response = await fetch(`${API_BASE}/tasks${query}`);
      if (!response.ok) throw new Error('Failed to fetch tasks');
      return response.json();
    },

    retry: async (id: number): Promise<TaskRow> => {
      const response = await fetch(`${API_BASE}/tasks/${id}/retry`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to retry task');
      return response.json();
    },

    dismiss: async (id: number): Promise<TaskRow> => {
      const response = await fetch(`${API_BASE}/tasks/${id}/dismiss`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to dismiss task');
      return response.json();
    },

    retryBulk: async (filters: { state?: TaskState; type?: string }): Promise<{ updated: number }> => {
      const response = await fetch(`${API_BASE}/tasks/bulk/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      if (!response.ok) throw new Error('Failed to retry tasks');
      return response.json();
    },

    dismissBulk: async (filters: { state?: TaskState; type?: string }): Promise<{ updated: number }> => {
      const response = await fetch(`${API_BASE}/tasks/bulk/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      if (!response.ok) throw new Error('Failed to dismiss tasks');
      return response.json();
    },
  },

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
        needsAttention?: boolean;
        archived?: boolean;
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
        // Needs-attention worklist (ADR 0024)
        if (filters.needsAttention) {
          params.append('needs_attention', 'true');
        }
        // Archived view (default listings exclude archived server-side)
        if (filters.archived) {
          params.append('archived', 'true');
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

    /** Playlists containing this track (for the archive confirm). */
    getPlaylists: async (id: number): Promise<Playlist[]> => {
      const response = await fetch(`${API_BASE}/tracks/${id}/playlists`);
      return response.json();
    },

    /** Archive (CONTEXT.md): curation verdict — removes from all playlists. */
    archive: async (id: number): Promise<{ archived_at: string | null; removed_from_playlists: number }> => {
      const response = await fetch(`${API_BASE}/tracks/${id}/archive`, { method: 'POST' });
      return response.json();
    },

    /** Reverse the verdict (playlist membership is not restored). */
    unarchive: async (id: number): Promise<Track> => {
      const response = await fetch(`${API_BASE}/tracks/${id}/unarchive`, { method: 'POST' });
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
      // Cue persistence is fire-and-forget at the call site (DeckContext
      // voids the promise) — a swallowed non-ok response is how a broken
      // contract went unnoticed for months. Throw so it at least lands in
      // the console as an unhandled rejection.
      if (!response.ok) {
        throw new Error(`cue-point persist failed (${response.status}) for track ${trackId}`);
      }
      return response.json();
    },
  },

  drops: {
    /** Possible-drop hypotheses (structure-analysis 02): analysis opinion
     * computed from blob + grid; empty drops while inputs are missing. */
    get: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/drops/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch drops: ${response.statusText}`);
      }
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

    dropAnchor: async (trackId: number, dropTime: number) => {
      const response = await fetch(`${API_BASE}/beatgrids/${trackId}/drop-anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_time: dropTime }),
      });
      if (!response.ok) {
        throw new Error(`Failed to anchor drop: ${response.statusText}`);
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

  metricLadders: {
    get: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/metric-ladders/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch metric ladder: ${response.statusText}`);
      }
      return response.json();
    },

    /** Full-state upsert: the authoritative mark list (server sorts/dedupes;
     * a default-state body clears the row; stored arities are preserved —
     * marks are the only editable surface). */
    put: async (trackId: number, resetMarks: number[]) => {
      const response = await fetch(`${API_BASE}/metric-ladders/${trackId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_marks: resetMarks }),
      });
      if (!response.ok) {
        throw new Error(`Failed to update metric ladder: ${response.statusText}`);
      }
      return response.json();
    },

    delete: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/metric-ladders/${trackId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`Failed to clear metric ladder: ${response.statusText}`);
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

    /** Hot cues for many tracks in one request, keyed by track id —
     * every id is present (empty list = no cues). Set open fetches the
     * whole set's cues through this (issue 43: N GETs → 1). */
    getBulk: async (trackIds: number[]): Promise<Record<number, HotCue[]>> => {
      const response = await fetch(`${API_BASE}/hotcues/bulk?track_ids=${trackIds.join(',')}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch hot cues: ${response.statusText}`);
      }
      return response.json();
    },

    set: async (trackId: number, slotNumber: number, data: {
      time_seconds: number;
      label?: string | null;
      color?: string | null;
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
    // Manual analysis rides the task system (ADR 0003, task-system 01): this
    // enqueues one `manual` grid+key task (overwriting freely) and returns
    // its state; the worker analyzes off-thread. Poll status() until `done`,
    // then refetch the track/grid.
    enqueue: async (trackId: number): Promise<AnalysisTaskStatus | null> => {
      const response = await fetch(`${API_BASE}/analyze/${trackId}`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`Failed to enqueue analysis: ${response.statusText}`);
      }
      return response.json();
    },

    status: async (trackId: number): Promise<AnalysisTaskStatus | null> => {
      const response = await fetch(`${API_BASE}/analyze/${trackId}/status`);
      if (!response.ok) {
        throw new Error(`Failed to fetch analysis status: ${response.statusText}`);
      }
      return response.json();
    },

    // Bulk in-flight view (analysis-curation 03): every pending/running
    // analysis task, library-wide — the poll target that keeps track rows
    // live and marks Analyze buttons already-running.
    pending: async (): Promise<AnalysisPendingItem[]> => {
      const response = await fetch(`${API_BASE}/analyze/pending`);
      if (!response.ok) {
        throw new Error(`Failed to fetch pending analyses: ${response.statusText}`);
      }
      return response.json();
    },

    getGrid: async (trackId: number) => {
      const response = await fetch(`${API_BASE}/analyze/grid/${trackId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch grid analysis: ${response.statusText}`);
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
        throw new Error(detailToMessage(error.detail, 'Failed to sync playlist'));
      }
      return res.json();
    },

    exportPerformance: async (
      playlistName: string,
      targets: PlaylistExportTarget[],
    ): Promise<PlaylistFullExportReport> => {
      const encodedName = encodeURIComponent(playlistName);
      const res = await fetch(`${API_BASE}/sync/export/playlists/${encodedName}/performance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detailToMessage(detail, 'Failed to export playlist performance data'));
      }
      return res.json();
    },

    previewExportPerformance: async (
      playlistName: string,
    ): Promise<PlaylistFullExportPreview> => {
      const encodedName = encodeURIComponent(playlistName);
      const res = await fetch(
        `${API_BASE}/sync/export/playlists/${encodedName}/performance/preview`,
      );
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detailToMessage(detail, 'Failed to preview playlist export'));
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

    exportToEngine: async (request: EngineTrackExportRequest): Promise<EngineTrackExportResult> => {
      const res = await fetch(`${API_BASE}/sync/tracks/engine/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detailToMessage(detail, 'Failed to export tracks to Engine DJ'));
      }
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

  syncExport: {
    /** Write the Library's key onto the matching Rekordbox track. Overwrites
     * Rekordbox's saved key — callers confirm first. Rekordbox must be
     * closed (409 with a readable reason otherwise). */
    exportKeyToRekordbox: async (request: {
      track_id: number;
    }): Promise<{ exported: boolean; key: string }> => {
      const res = await fetch(`${API_BASE}/sync/export/key/rekordbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detailToMessage(detail, 'Failed to export key to Rekordbox'));
      }
      return res.json();
    },

    /** Write the Library's hot cues onto the matching Rekordbox track,
     * mirrored to hot + memory cues. "add-only" never touches existing RB
     * rows; "replace-all" is the confirmed full-mirror reconcile (moves +
     * soft-deletes RB-only cues). Rekordbox must be closed. */
    /** The auto tier (issue 08): values NEW in the Library flow out to
     * Rekordbox without confirmation — hot cues add-only, key only where
     * Rekordbox has none. Never touches existing RB values. */
    autoExportToRekordbox: async (request: {
      track_ids: number[] | null;
    }): Promise<{ scanned: number; matched: number; cues_added: number; keys_set: number; unmatched: number }> => {
      const res = await fetch(`${API_BASE}/sync/export/rekordbox/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detailToMessage(detail, 'Failed to auto-export to Rekordbox'));
      }
      return res.json();
    },

    /** Author the Rekordbox grid (ANLZ PQTZ + BPM scalar) from the
     * Library's saved Beatgrid. Always overwrites — confirmed tier.
     * Rekordbox must be closed. */
    exportBeatgridToRekordbox: async (request: {
      track_id: number;
    }): Promise<{ beats: number; tempo_changes: number; bpm: number }> => {
      const res = await fetch(`${API_BASE}/sync/export/beatgrid/rekordbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detailToMessage(detail, 'Failed to export beatgrid to Rekordbox'));
      }
      return res.json();
    },

    exportHotcuesToRekordbox: async (request: {
      track_id: number;
      mode: 'add-only' | 'replace-all';
    }): Promise<{ added: number; moved: number; deleted: number; skipped_slots: number[] }> => {
      const res = await fetch(`${API_BASE}/sync/export/hotcues/rekordbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detailToMessage(detail, 'Failed to export hot cues to Rekordbox'));
      }
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
        /** Naive-UTC ISO string (sets 26: resolution recency). */
        updated_at: string | null;
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
        throw new Error(detailToMessage(error.detail, 'Failed to refresh source items'));
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
        throw new Error(detailToMessage(error.detail, 'Failed to ignore item'));
      }
      return res.json();
    },

    restoreItem: async (itemId: number): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/restore`, { method: 'POST' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(detailToMessage(error.detail, 'Failed to restore item'));
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
        throw new Error(detailToMessage(error.detail, 'Failed to set provenance'));
      }
      return res.json();
    },

    queueDownload: async (itemId: number): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/queue`, { method: 'POST' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(detailToMessage(error.detail, 'Failed to queue download'));
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

    // Suppliers (soulseek-supplier issue 03). An unconfigured Supplier is
    // absent from this list and its UI never renders.
    getSuppliers: async (): Promise<SupplierInfo[]> => {
      const res = await fetch(`${API_BASE}/acquisition/suppliers`);
      if (!res.ok) throw new Error('Failed to fetch suppliers');
      return res.json();
    },

    soulseekSearch: async (itemId: number, query: string): Promise<SoulseekSearchResponse> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/soulseek/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query || null }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(detailToMessage(error.detail, 'Soulseek search failed'));
      }
      return res.json();
    },

    soulseekPick: async (itemId: number, result: SoulseekResult): Promise<SourceItem> => {
      const res = await fetch(`${API_BASE}/acquisition/items/${itemId}/soulseek/pick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(detailToMessage(error.detail, 'Soulseek pick failed'));
      }
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

  cameos: {
    /** All saved Cameos (boot/plan load; #140). Ordered (host, guest)
     * pair, then position — the Cameo sibling of transitions.list. */
    list: async (): Promise<CameoRowWire[]> => {
      const res = await fetch(`${API_BASE}/cameos`);
      if (!res.ok) throw new Error('Failed to fetch cameos');
      return res.json();
    },

    /** Client-authoritative pair-replace (ADR 0011 pattern): the server
     * reconciles the ordered (host, guest) pair by uuid. An empty items
     * list deletes the pair. Deleted Cameos DROP Set Cameo pins. */
    replacePair: async (
      hostTrackId: number,
      guestTrackId: number,
      items: { uuid: string; name: string; favorite: boolean; data: Record<string, unknown> }[]
    ): Promise<CameoRowWire[]> => {
      const res = await fetch(`${API_BASE}/cameos/pair/${hostTrackId}/${guestTrackId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(`Failed to save cameos (${res.status})`);
      return res.json();
    },
  },

  trackLinks: {
    /** All Linked pairs (boot load), canonical order low < high. */
    list: async (): Promise<{ low_track_id: number; high_track_id: number }[]> => {
      const res = await fetch(`${API_BASE}/track-links`);
      if (!res.ok) throw new Error('Failed to fetch track links');
      return res.json();
    },

    /** Idempotently set/clear the Linked fact for an unordered pair —
     * the server normalizes order, so a/b and b/a address the same fact. */
    setPair: async (aTrackId: number, bTrackId: number, linked: boolean) => {
      const res = await fetch(`${API_BASE}/track-links/pair/${aTrackId}/${bTrackId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked }),
      });
      if (!res.ok) throw new Error(`Failed to save track link (${res.status})`);
      return res.json();
    },
  },
  takes: {
    /** The Transition history, newest first — metadata only (the raw
     * event slice stays behind get(); transition-takes 02, ADR 0020). */
    list: async (): Promise<TakeRowWire[]> => {
      const res = await fetch(`${API_BASE}/takes`);
      if (!res.ok) throw new Error('Failed to fetch takes');
      return res.json();
    },

    /** One Take with its evidence (raw capture-event slice + detector
     * parameter snapshot) — vectorization input (issue 03). */
    get: async (uuid: string): Promise<TakeDetailWire> => {
      const res = await fetch(`${API_BASE}/takes/${uuid}`);
      if (!res.ok) throw new Error(`Failed to fetch take (${res.status})`);
      return res.json();
    },

    /** Persist a settled Handover (posted by the capture recorder). */
    create: async (take: TakeCreateWire): Promise<TakeRowWire> => {
      const res = await fetch(`${API_BASE}/takes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(take),
      });
      if (!res.ok) throw new Error(`Failed to create take (${res.status})`);
      return res.json();
    },

    delete: async (uuid: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/takes/${uuid}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete take (${res.status})`);
    },

    /** Record (or clear) the Transition a Take was promoted into. */
    setPromoted: async (uuid: string, transitionUuid: string | null): Promise<TakeRowWire> => {
      const res = await fetch(`${API_BASE}/takes/${uuid}/promoted`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promoted_transition_uuid: transitionUuid }),
      });
      if (!res.ok) throw new Error(`Failed to set take promotion (${res.status})`);
      return res.json();
    },
  },

  routineCandidates: {
    /** ALL miner-suggested candidate spans (sets #161): the Set pane
     * matches casts against adjacencies client-side for the row-level
     * "routines detected" highlight (the picker still queries per head). */
    list: async (): Promise<RoutineCandidateWire[]> => {
      const res = await fetch(`${API_BASE}/routine-candidates`);
      if (!res.ok) throw new Error(`Failed to fetch routine candidates (${res.status})`);
      return res.json();
    },

    /** A Session's miner-suggested Routine spans, timeline order (ADR
     * 0035, routines 157) — the confirm surface reads this. */
    forSession: async (sessionUuid: string): Promise<RoutineCandidateWire[]> => {
      const res = await fetch(
        `${API_BASE}/routine-candidates?session_uuid=${encodeURIComponent(sessionUuid)}`
      );
      if (!res.ok) throw new Error(`Failed to fetch routine candidates (${res.status})`);
      return res.json();
    },

    /** Cast-prefix match (routines 157): candidates whose cast covers
     * exactly the given ordered list's next len(cast) entries, entering
     * on the first and exiting at the last — the pin picker's lowest
     * trust tier (sets 160). Strongest evidence first. */
    query: async (trackIds: number[]): Promise<RoutineCandidateWire[]> => {
      const res = await fetch(`${API_BASE}/routine-candidates/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: trackIds }),
      });
      if (!res.ok) throw new Error(`Failed to query routine candidates (${res.status})`);
      return res.json();
    },
  },

  routineTakes: {
    /** Routine Takes, newest first (the Transition history reads this
     * alongside takes.list; ADR 0035, routines 158). */
    list: async (): Promise<RoutineTakeRowWire[]> => {
      const res = await fetch(`${API_BASE}/routine-takes`);
      if (!res.ok) throw new Error('Failed to fetch routine takes');
      return res.json();
    },

    /** Confirm a candidate span (with boundary trim) into a Routine Take.
     * n ≥ 3 — a 2-cast confirm is a hand-cut Take (POST /api/takes). */
    create: async (payload: RoutineTakeCreateWire): Promise<RoutineTakeRowWire> => {
      const res = await fetch(`${API_BASE}/routine-takes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to confirm routine take (${res.status})`);
      return res.json();
    },

    /** Mechanical promotion: deck→slot re-addressing + beat-domain rebase
     * via the cast Beatgrids → a saved Routine. */
    promote: async (uuid: string): Promise<RoutineRowWire> => {
      const res = await fetch(`${API_BASE}/routine-takes/${uuid}/promote`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Failed to promote routine take (${res.status})`);
      }
      return res.json();
    },

    delete: async (uuid: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/routine-takes/${uuid}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete routine take (${res.status})`);
    },
  },

  routines: {
    /** All saved Routines, newest first — metadata only. */
    list: async (): Promise<RoutineRowWire[]> => {
      const res = await fetch(`${API_BASE}/routines`);
      if (!res.ok) throw new Error('Failed to fetch routines');
      return res.json();
    },

    /** One Routine with its slot-addressed, beat-domain event replay. */
    get: async (uuid: string): Promise<RoutineDetailWire> => {
      const res = await fetch(`${API_BASE}/routines/${uuid}`);
      if (!res.ok) throw new Error(`Failed to fetch routine (${res.status})`);
      return res.json();
    },

    rename: async (uuid: string, name: string | null): Promise<RoutineRowWire> => {
      const res = await fetch(`${API_BASE}/routines/${uuid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`Failed to rename routine (${res.status})`);
      return res.json();
    },

    delete: async (uuid: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/routines/${uuid}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete routine (${res.status})`);
    },
  },

  sessions: {
    /** The Sessions list, newest first — headers + Take count (ADR 0033). */
    list: async (): Promise<SessionRowWire[]> => {
      const res = await fetch(`${API_BASE}/sessions`);
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },

    /** One Session with its whole event log (chunks concatenated) — the
     * timeline's read model (sessions 04). */
    get: async (uuid: string): Promise<SessionDetailWire> => {
      const res = await fetch(`${API_BASE}/sessions/${uuid}`);
      if (!res.ok) throw new Error(`Failed to fetch session (${res.status})`);
      return res.json();
    },

    /** Close Sessions orphaned by a prior crash/reload before recording;
     * the backend also sweeps 100%-silent rows (sessions 11). */
    recover: async (): Promise<number> => {
      const res = await fetch(`${API_BASE}/sessions/recover`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to recover sessions (${res.status})`);
      const body: { closed: number } = await res.json();
      return body.closed;
    },

    /** Open a Session on the first Master-audible instant (sessions 11);
     * the client mints the uuid. */
    create: async (uuid: string, startedAt?: string): Promise<SessionRowWire> => {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid, started_at: startedAt }),
      });
      if (!res.ok) throw new Error(`Failed to create session (${res.status})`);
      return res.json();
    },

    /** Append one batch of capture events (~5s flush; ADR 0033). */
    appendChunk: async (
      uuid: string,
      seq: number,
      events: CaptureEventWire[]
    ): Promise<SessionRowWire> => {
      const res = await fetch(`${API_BASE}/sessions/${uuid}/chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq, events }),
      });
      if (!res.ok) throw new Error(`Failed to append session chunk (${res.status})`);
      return res.json();
    },

    /** Close a Session (recorder dispose / page-hide). */
    end: async (uuid: string, endedAt?: string): Promise<SessionRowWire> => {
      const res = await fetch(`${API_BASE}/sessions/${uuid}/end`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_at: endedAt }),
      });
      if (!res.ok) throw new Error(`Failed to end session (${res.status})`);
      return res.json();
    },

    delete: async (uuid: string): Promise<void> => {
      const res = await fetch(`${API_BASE}/sessions/${uuid}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete session (${res.status})`);
    },
  },

  sets: {
    /** All Sets, in sidebar order (sets 01). */
    list: async (): Promise<SetRowWire[]> => {
      const res = await fetch(`${API_BASE}/sets`);
      if (!res.ok) throw new Error('Failed to fetch sets');
      return res.json();
    },

    /** One Set with its ordered entries. */
    get: async (id: number): Promise<SetWithEntriesWire> => {
      const res = await fetch(`${API_BASE}/sets/${id}`);
      if (!res.ok) throw new Error(`Failed to fetch set (${res.status})`);
      return res.json();
    },

    create: async (data: { name: string; color?: string }): Promise<SetRowWire> => {
      const res = await fetch(`${API_BASE}/sets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Failed to create set (${res.status})`);
      return res.json();
    },

    update: async (
      id: number,
      data: {
        name?: string;
        color?: string;
        display_order?: number;
        /** Tempo policy (sets 06); a null set_tempo_bpm defaults from the
         * first track's BPM at plan time. */
        tempo_policy?: 'riding' | 'fixed';
        set_tempo_bpm?: number | null;
      }
    ): Promise<SetRowWire> => {
      const res = await fetch(`${API_BASE}/sets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Failed to update set (${res.status})`);
      return res.json();
    },

    delete: async (id: number): Promise<void> => {
      const res = await fetch(`${API_BASE}/sets/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete set (${res.status})`);
    },

    /** Client-authoritative wholesale replace of the ordered entry list
     * (ADR 0011 pattern): the server reconciles by track_id. Dormant
     * pins (sets 07) and Dormant Cameo pins (#140) are Set state and
     * ride the same PUT wholesale. */
    replaceEntries: async (
      id: number,
      items: SetEntryItemWire[],
      dormant: SetDormantPinWire[] = [],
      dormantCameos: SetDormantCameoPinWire[] = []
    ): Promise<SetWithEntriesWire> => {
      const res = await fetch(`${API_BASE}/sets/${id}/entries`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, dormant, dormant_cameos: dormantCameos }),
      });
      if (!res.ok) throw new Error(`Failed to save set entries (${res.status})`);
      return res.json();
    },
  },
};

// ── Take wire types (transition-takes 02) ───────────────────────────────

export interface TakeRowWire {
  uuid: string;
  a_track_id: number;
  b_track_id: number;
  detected_at: string;
  /** Take window on the capture clock (glossary: the engagement). */
  window_start_s: number;
  window_end_s: number;
  confidence: number;
  detector_version: number;
  promoted_transition_uuid: string | null;
  /** The Session this Take was born from (provenance, nullable; ADR 0033). */
  session_uuid: string | null;
  /** How the Take came to be: 'detected' or 'manual' (issue 06). */
  origin: string;
  /** Survivor-rule verdict (#140): 'handover', or 'guest' — a CAMEO TAKE
   * (a = the surviving host, b = the visiting guest). */
  kind: 'handover' | 'guest';
  /** Engagement identity (#140): pairwise offspring of one multi-deck
   * engagement share it (the history groups by it). Null pre-#140. */
  engagement_uuid: string | null;
}

export interface TakeDetailWire extends TakeRowWire {
  /** The evidence — opaque to the BACKEND, but this client both writes and
   * reads it, so the wire keeps the capture module's real types. */
  params: CaptureDetectorParams;
  events: CaptureEventWire[];
}

export interface TakeCreateWire {
  uuid: string;
  a_track_id: number;
  b_track_id: number;
  window_start_s: number;
  window_end_s: number;
  confidence: number;
  detector_version: number;
  params: CaptureDetectorParams;
  events: CaptureEventWire[];
  /** The Session this Take was born from (nullable; ADR 0033). */
  session_uuid?: string | null;
  /** 'detected' (default) or 'manual' (hand-cut, issue 06). */
  origin?: string;
  /** Survivor-rule verdict (#140); absent = 'handover'. */
  kind?: 'handover' | 'guest';
  /** Engagement identity (#140); absent/null for hand cuts without one. */
  engagement_uuid?: string | null;
}

// ── Routine wire types (ADR 0035, routines 157/158) ─────────────────────

export interface RoutineCandidateWire {
  uuid: string;
  session_uuid: string;
  /** Entry-ordered cast (track ids = slot order). */
  cast: number[];
  /** Capture-clock window on the owning Session. */
  window_start_s: number;
  window_end_s: number;
  /** Per slot, seconds from window start (slot 0 = 0.0). */
  entry_offsets: number[];
  evidence: Record<string, number>;
  miner_version: number;
  created_at: string | null;
}

export interface RoutineTakeCreateWire {
  uuid: string;
  session_uuid: string;
  window_start_s: number;
  window_end_s: number;
  cast: number[];
  entry_offsets: number[];
  origin_candidate_uuid?: string | null;
}

export interface RoutineTakeRowWire {
  uuid: string;
  session_uuid: string;
  cast: number[];
  window_start_s: number;
  window_end_s: number;
  entry_offsets: number[];
  origin_candidate_uuid: string | null;
  promoted_routine_uuid: string | null;
  confirmed_at: string;
}

export interface RoutineRowWire {
  uuid: string;
  name: string | null;
  cast: number[];
  /** Per slot, beats from Routine start. */
  entry_offsets_beats: number[];
  /** Per slot, track position (seconds) at its entry. */
  entry_positions: number[];
  duration_beats: number;
  origin_take_uuid: string | null;
  created_at: string | null;
}

export interface RoutineDetailWire extends RoutineRowWire {
  /** Slot-addressed, beat-domain mechanical replay (each event carries
   * `beat` + `slot`; global controls carry slot null). */
  events: Record<string, unknown>[];
}

// ── Session wire types (Sessions PRD, ADR 0033) ─────────────────────────

export interface SessionRowWire {
  uuid: string;
  started_at: string;
  ended_at: string | null;
  take_count: number;
}

export interface SessionDetailWire extends SessionRowWire {
  /** The whole event log, chunks concatenated in seq order. Opaque to the
   * backend; this client reads it with the capture module's real types. */
  events: CaptureEventWire[];
}

// ── Cameo wire types (cameos PRD, #140) ─────────────────────────────────

export interface CameoRowWire {
  host_track_id: number;
  guest_track_id: number;
  uuid: string;
  position: number;
  name: string;
  favorite: boolean;
  /** Opaque payload: two-edged window in host track seconds, guest
   * alignment, optional guest→host tempo-match, role lanes, Jumps on
   * both roles. The client owns the shape (see sets/cameoPlan.ts). */
  data: Record<string, unknown>;
  updated_at: string | null;
}

// ── Set wire types (sets 01) ────────────────────────────────────────────

export interface SetRowWire {
  id: number;
  name: string;
  color: string | null;
  display_order: number;
  /** Tempo policy (sets 06): Riding (Tempo returns) or Fixed (Set tempo). */
  tempo_policy: 'riding' | 'fixed';
  /** Explicit Set tempo (Fixed); null = first track's BPM at plan time. */
  set_tempo_bpm: number | null;
  /** Sets 12: the Set contains an Archived Track — flagged, never altered. */
  has_archived_tracks: boolean;
}

/** One Cameo pin (#140): a guest ornament on a Set entry — a saved Cameo
 * or, manually, a Cameo Take hosted by that entry's Track. Always manual;
 * never auto-filled. */
export interface CameoPinWire {
  pin_kind: 'cameo' | 'cameo-take';
  pin_uuid: string;
}

/** A Dormant Cameo pin (#140): kept while its host Track is out of the
 * Set (Cameo dormancy keys on the host Track per Set, not on a pair). */
export interface SetDormantCameoPinWire extends CameoPinWire {
  host_track_id: number;
}

export interface SetEntryItemWire {
  track_id: number;
  /** Adjacency pin (sets 02): kind and uuid travel together for
   * transition/take/routine (sets 160); a Hard-cut pin (sets 26)
   * carries no uuid. */
  pin_kind?: 'transition' | 'take' | 'hardcut' | 'routine' | null;
  pin_uuid?: string | null;
  /** Per-entry trim (sets #164): an OFFSET from neutral in mixer-knob
   * units (0 = neutral, ±0.5 spans the knob) — composes with track
   * Autogain when that lands (ADR 0034). Absent = neutral. */
  trim?: number;
  /** Cameo pins (#140): ordered guest ornaments hosted by this entry's
   * Track. Adjacency-independent. Absent = none. */
  cameo_pins?: CameoPinWire[];
}

export interface SetEntryRowWire {
  track_id: number;
  position: number;
  pin_kind: 'transition' | 'take' | 'hardcut' | 'routine' | null;
  pin_uuid: string | null;
  /** Trim offset from neutral, knob units (sets #164). */
  trim: number;
  /** Cameo pins (#140), in pin order. */
  cameo_pins: CameoPinWire[];
}

/** A Dormant pin (sets 07): a broken pin remembered per ORDERED track
 * pair, per Set — same shape on PUT and GET. A routine memory (sets
 * 160) is keyed by its BOUNDARY tracks (entry, exit). */
export interface SetDormantPinWire {
  a_track_id: number;
  b_track_id: number;
  pin_kind: 'transition' | 'take' | 'hardcut' | 'routine';
  pin_uuid: string | null;
}

export interface SetWithEntriesWire extends SetRowWire {
  entries: SetEntryRowWire[];
  dormant: SetDormantPinWire[];
  /** Dormant Cameo pins (#140): host-track-keyed memories. */
  dormant_cameos: SetDormantCameoPinWire[];
}
