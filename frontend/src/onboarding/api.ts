/** Onboarding endpoints (#274 backend): Rekordbox detect / preview /
 * import (task) / status, plus the First-run library-total probe. */
import { BACKEND_URL, detailToMessage } from '../api/client';

const API_BASE = `${BACKEND_URL}/api`;

export interface RekordboxDetect {
  found: boolean;
  library_dir: string | null;
}

export interface RekordboxPreview {
  library_dir: string;
  tracks_total: number;
  tracks_importable: number;
  tracks_already_imported: number;
  tracks_missing_file: number;
  tracks_streaming: number;
  hotcues: number;
  saved_loops: number;
  grids: number;
  keys: number;
  tag_categories: number;
  tags: number;
  tag_assignments: number;
  genres: number;
  playlists: number;
  smart_playlists: number;
  smart_playlists_skipped: number;
}

export interface RekordboxImportSummary {
  tracks_imported: number;
  tracks_already_imported: number;
  tracks_missing_file: number;
  tracks_streaming: number;
  hotcues_applied: number;
  beatgrids_applied: number;
  maincues_applied: number;
  keys_applied: number;
  pending_conflicts: number;
  tag_categories_created: number;
  tags_created: number;
  tag_assignments_added: number;
  genre_tags_created: number;
  genre_assignments_added: number;
  playlists_created: number;
  playlist_entries_added: number;
  playlists_already_present: number;
  smart_playlists_snapshotted: number;
  smart_playlists_skipped: number;
  dropped_memory_cues: number;
  dropped_loops: number;
}

export interface ImportProgress {
  phase: string;
  done: number;
  total: number;
}

export interface RekordboxImportStatus {
  state: 'none' | 'pending' | 'running' | 'done' | 'failed';
  progress: ImportProgress | null;
  summary: RekordboxImportSummary | null;
  error: string | null;
}

async function json<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let detail: unknown = null;
    try {
      detail = (await response.json()).detail;
    } catch {
      // non-JSON error body
    }
    throw new Error(detailToMessage(detail, fallback));
  }
  return response.json() as Promise<T>;
}

export const onboardingApi = {
  libraryTotal: async (): Promise<number> => {
    const r = await fetch(`${API_BASE}/tracks/?per_page=1`);
    const data = await json<{ library_total: number }>(r, 'Failed to read library');
    return data.library_total;
  },
  detect: async (): Promise<RekordboxDetect> =>
    json(await fetch(`${API_BASE}/onboarding/rekordbox/detect`), 'Detection failed'),
  preview: async (): Promise<RekordboxPreview> =>
    json(await fetch(`${API_BASE}/onboarding/rekordbox/preview`), 'Preview failed'),
  startImport: async (includeGenre: boolean): Promise<{ task_id: number }> =>
    json(
      await fetch(`${API_BASE}/onboarding/rekordbox/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_genre: includeGenre }),
      }),
      'Failed to start import',
    ),
  status: async (): Promise<RekordboxImportStatus> =>
    json(await fetch(`${API_BASE}/onboarding/rekordbox/status`), 'Failed to read import status'),
};

// -- tracks directory (#276) --------------------------------------------------

export interface TracksDirectorySummary {
  directory: string;
  files_scanned: number;
  already_in_library: number;
  imported: number;
  errors: number;
  error_messages: string[];
}

export interface TracksDirectoryStatus {
  state: 'none' | 'pending' | 'running' | 'done' | 'failed';
  progress: ImportProgress | null;
  summary: TracksDirectorySummary | null;
  error: string | null;
}

export const tracksDirectoryApi = {
  startScan: async (): Promise<{ task_id: number }> =>
    json(
      await fetch(`${API_BASE}/onboarding/tracks-directory/import`, { method: 'POST' }),
      'Failed to start the scan',
    ),
  status: async (): Promise<TracksDirectoryStatus> =>
    json(await fetch(`${API_BASE}/onboarding/tracks-directory/status`), 'Failed to read scan status'),
};
