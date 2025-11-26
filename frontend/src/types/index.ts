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
  category: TagCategory;
}

export interface Track {
  id: number;
  filename: string;
  file_hash?: string;
  energy?: number;  // 1-5 energy level
  title?: string;
  artist?: string;
  key?: string;
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

export interface WaveformData {
  sample_rate: number;
  duration: number;
  peaks: number[];
  samples_per_peak: number;
  cue_point_time: number | null;
}

export interface WaveformResponse {
  id: number;
  track_id: number;
  data: WaveformData;
  created_at: string;
  updated_at: string;
}
