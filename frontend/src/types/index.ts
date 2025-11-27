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
