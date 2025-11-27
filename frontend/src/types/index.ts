export interface TagCategory {
  id: number;
  name: string;
  display_order: number;
  color?: string;
}

export interface Tag {
  id: number;
  name: string;
  category_id: number;
  display_order: number;
  color?: string;
  category: TagCategory;
  track_count?: number;
}

export interface TagUpdate {
  name?: string;
  color?: string;
  display_order?: number;
}

export interface TagCreate {
  name: string;
  category_id: number;
  color?: string;
  display_order?: number;
}

export interface Track {
  id: number;
  filename: string;
  file_hash?: string;
  energy?: number;  // 1-5 energy level
  title?: string;
  artist?: string;
  key?: number;  // Engine DJ key ID (0-23)
  bpm?: number;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

export interface PaginatedTracks {
  items: Track[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface WaveformBands {
  low: number[];  // Bass: 20-250Hz
  mid: number[];  // Mids: 250-4000Hz
  high: number[]; // Highs: 4000-20000Hz
}

export interface WaveformData {
  sample_rate: number;
  duration: number;
  samples_per_peak: number;
  cue_point_time: number | null;
  bands: WaveformBands;
}

export interface WaveformResponse {
  id: number;
  track_id: number;
  data: WaveformData;
  png_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Playlist {
  id: number;
  name: string;
  color?: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

export interface PlaylistTrackAdd {
  track_id: number;
  position?: number;
}

export interface PlaylistTrackReorder {
  track_positions: Array<{ id: number; position: number }>;
}

export interface TempoChange {
  start_time: number;
  bpm: number;
  time_signature_num: number;
  time_signature_den: number;
  bar_position: number;
}

export interface BeatgridData {
  tempo_changes: TempoChange[];
  beat_times: number[];
  downbeat_times: number[];
}

export interface BeatgridResponse {
  id: number;
  track_id: number;
  data: BeatgridData;
  created_at: string;
  updated_at: string;
}

export interface TrackEntry {
  filename: string;
  track_id?: number | string | null;
}

export interface UnifiedPlaylist {
  name: string;
  manadj: TrackEntry[] | null;
  engine: TrackEntry[] | null;
  rekordbox: TrackEntry[] | null;
  synced: boolean;
}

export interface PlaylistSyncStats {
  manadj_playlists_loaded: number;
  engine_playlists_loaded: number;
  rekordbox_playlists_loaded: number;
  playlists_matched: number;
  playlists_unique_manadj: number;
  playlists_unique_engine: number;
  playlists_unique_rekordbox: number;
  conflicts_detected: number;
}

export interface TagInfo {
  name: string;
  category_name: string;
  source: string;
  tag_id: number | string;
  category_id: number | string;
  display_order: number | null;
  color: string | null;
  track_count: number;
}

export interface UnifiedTagView {
  category_name: string;
  tag_name: string;
  manadj: TagInfo | null;
  engine: TagInfo | null;
  rekordbox: TagInfo | null;
  synced: boolean;
}

export interface TagSyncStats {
  manadj_categories_loaded: number;
  manadj_tags_loaded: number;
  engine_playlists_scanned: number;
  engine_tags_found: number;
  rekordbox_categories_loaded: number;
  rekordbox_tags_loaded: number;
  categories_matched: number;
  tags_matched: number;
  categories_unique_manadj: number;
  tags_unique_manadj: number;
  categories_unique_engine: number;
  tags_unique_engine: number;
  categories_unique_rekordbox: number;
  tags_unique_rekordbox: number;
  categories_created: number;
  categories_updated: number;
  tags_created: number;
  tags_updated: number;
  tracks_matched: number;
  tracks_unmatched: number;
  tracks_updated: number;
  tracks_colored: number;
}

export interface TagSyncRequest {
  target: 'engine' | 'rekordbox';
  dry_run: boolean;
  fresh?: boolean;
  include_energy?: boolean;
}

export interface SyncResult {
  target: string;  // 'manadj', 'engine', or 'rekordbox'
  success: boolean;
  created: boolean;  // True if playlist was created, False if updated
  tracks_synced: number;
  tracks_unmatched: string[];  // Filenames that couldn't be matched
  error?: string | null;
}

export interface SyncPlaylistRequest {
  source: string;  // 'manadj', 'engine', or 'rekordbox'
  target?: string | null;  // Single target, or null to sync to all
  ignore_missing_tracks: boolean;
  dry_run: boolean;
}

export interface TrackDiscrepancy {
  filename: string;
  title?: string | null;
  artist?: string | null;
  bpm?: number | null;
  key?: number | null;
  source_system: string;  // 'manadj', 'engine', or 'rekordbox'
}

export interface TrackSyncStats {
  manadj_total: number;
  target_total: number;
  missing_in_target_count: number;
  missing_in_manadj_count: number;
  skipped_file_not_found: number;
}

export interface TrackSyncResult {
  target: string;  // 'engine' or 'rekordbox'
  stats: TrackSyncStats;
  missing_in_target: TrackDiscrepancy[];  // Export candidates
  missing_in_manadj: TrackDiscrepancy[];  // Import candidates
}
