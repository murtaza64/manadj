// Column configuration - single source of truth for table layout
export interface ColumnConfig {
  id: string;
  width: number;
  sticky?: boolean;
  align?: 'left' | 'right';
  showShadow?: boolean; // Show shadow on right edge (for last sticky column)
}

export const COLUMN_CONFIG: ColumnConfig[] = [
  // Play order (#): playlist tables only — tables opt in via useColumnWidths(showOrder)
  { id: 'order', width: 36, sticky: true, align: 'right' },
  { id: 'key', width: 40, sticky: true, align: 'right' },
  { id: 'bpm', width: 40, sticky: true },
  { id: 'energy', width: 35, sticky: true },
  // Marks/match column (follow-mode 09, match-score PRD): two evidence
  // slots (per Deck A–D with evidence), or the Match score while Follow
  // filters. Crosshair header; resizable like any column. Wide enough
  // for the common 1–2 slots; 3–4 simultaneous Decks of evidence still
  // fit at reduced slot width (rows never wrap).
  { id: 'marks', width: 34, sticky: true },
  { id: 'title', width: 180, sticky: true, showShadow: true },
  { id: 'artist', width: 180 },
  { id: 'created_at', width: 75, align: 'right' },
  { id: 'tags', width: 700 },
  // Stems presence (stems map #118): a checkmark when current stems exist.
  { id: 'stems', width: 30 },
  { id: 'quality', width: 80, align: 'right' },
  { id: 'size', width: 60, align: 'right' },
  { id: 'provenance', width: 90 },
];

// Get column by id
export function getColumnConfig(id: string): ColumnConfig | undefined {
  return COLUMN_CONFIG.find(col => col.id === id);
}
