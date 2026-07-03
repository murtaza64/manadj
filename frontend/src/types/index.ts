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
  duration_secs?: number | null;
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

export interface EngineRBXMLSyncRequest {
  playlist_name?: string;
  output_path?: string;
  validate_files?: boolean;
  skip_import?: boolean;
}

export interface EngineRBXMLSyncResult {
  target: 'engine';
  exported_to_target: number;
  skipped_file_not_found: number;
  playlist_name: string | null;
  output_path: string | null;
}

export interface RekordboxTrackSyncRequest {
  dry_run: boolean;
  skip_export: boolean;
  skip_import: boolean;
  validate_files: boolean;
  playlist_name?: string;
}

export interface RekordboxTrackSyncResult {
  target: 'rekordbox';
  dry_run: boolean;
  skipped_file_not_found: number;
  missing_in_target_count: number;
  missing_in_manadj_count: number;
  exported_to_target: number;
  imported_to_manadj: number;
  playlist_name: string | null;
  playlist_created: boolean;
}

// Library import types
export interface LibraryTrackCandidate {
  filepath: string;
  filename: string;
  title: string | null;
  artist: string | null;
  bpm: number | null;
  key: string | null;
  has_metadata: boolean;
}

export interface LibraryImportStats {
  files_scanned: number;
  already_in_db: number;
  new_tracks: number;
  with_metadata: number;
  without_metadata: number;
}

export interface LibraryImportResult {
  candidates: LibraryTrackCandidate[];
  stats: LibraryImportStats;
}

export interface LibraryImportRequest {
  candidate_filepaths?: string[] | null;
}

export interface LibraryImportExecutionResult {
  imported: number;
  skipped_no_metadata: number;
  errors: number;
  error_messages: string[];
}

export interface BPMEstimate {
  method: string;
  bpm: number;
  confidence: number | null;
}

export interface BPMAnalysisResponse {
  track_id: number;
  estimates: BPMEstimate[];
  recommended_bpms: number[];
  recommended_bpm: number;
  metadata: {
    duration: number;
    analyzed_at: string;
  };
}

export interface KeyAnalysisResponse {
  track_id: number;
  key: string;
  formats: {
    musical: string;
    openkey: string | null;
    camelot: string | null;
    engine_id: number | null;
  };
  confidence: number;
  metadata: {
    scale: string;
    analyzed_at: string;
  };
}

// Metadata Sync types
export interface MetadataValues {
  title: string | null;
  artist: string | null;
  bpm: number | null;
  key: string | null;  // Musical notation
}

export interface MetadataComparison {
  track_id: number;
  filename: string;
  current: MetadataValues;  // From DB
  file: MetadataValues;  // From ID3 tags
  differences: string[];  // ["title", "artist", "bpm", "key"]
  conflict_type: string;  // "only_in_file", "only_in_db", "conflict", "match"
}

export interface MetadataComparisonStats {
  total_tracks: number;
  tracks_with_changes: number;
  tracks_with_conflicts: number;
  missing_files: number;
}

export interface MetadataComparisonResult {
  stats: MetadataComparisonStats;
  comparisons: MetadataComparison[];
}

export interface TrackMetadataUpdate {
  track_id: number;
  fields: Record<string, string | number | null>;
}

export interface MetadataSyncRequest {
  updates: TrackMetadataUpdate[];
  dry_run: boolean;
}

export interface MetadataSyncStats {
  total_requested: number;
  updated: number;
  skipped: number;
  errors: number;
  error_messages: string[];
}

export interface MetadataSyncResult {
  stats: MetadataSyncStats;
  dry_run: boolean;
}

// Hot Cue types
export interface HotCue {
  id: number;
  track_id: number;
  slot_number: number;  // 1-8
  time_seconds: number;
  label?: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

// Acquisition types (see CONTEXT.md: Source Item)
export type SourceItemState = 'new' | 'queued' | 'fulfilled' | 'ignored';

export interface SourceItem {
  id: number;
  source: string;
  external_id: string;
  title: string;
  uploader: string;
  duration_ms: number;
  permalink_url: string;
  state: SourceItemState;
  classification: Classification | null;
  liked_at: string | null;
  correspondence: SourceCorrespondenceInfo | null;
  download: DownloadStatus | null;
  downloaded_at: string | null;
}

export interface DownloadStatus {
  task_state: 'pending' | 'running' | 'done' | 'failed';
  error: string | null;
}

export interface SourceCorrespondenceInfo {
  track_id: number;
  status: 'proposed' | 'confirmed';
  score: number | null;
  track_title: string | null;
  track_artist: string | null;
  track_duration_secs: number | null;
}

export interface AcquisitionRefreshStats {
  added: number;
  total_remote: number;
  total_local: number;
}

export type Classification = 'track' | 'mix' | 'clip' | 'other';
