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
  { id: 'key', width: 35, sticky: true, align: 'right' },
  { id: 'bpm', width: 35, sticky: true },
  { id: 'energy', width: 35, sticky: true },
  // Marks column (follow-mode 09): two fixed evidence slots (A, B) —
  // blank header, not sortable, no resize handle (fixed width).
  { id: 'marks', width: 34, sticky: true },
  { id: 'title', width: 180, sticky: true, showShadow: true },
  { id: 'artist', width: 180 },
  { id: 'created_at', width: 75, align: 'right' },
  { id: 'tags', width: 700 },
  { id: 'quality', width: 80, align: 'right' },
  { id: 'size', width: 60, align: 'right' },
  { id: 'provenance', width: 90 },
];

// Get column by id
export function getColumnConfig(id: string): ColumnConfig | undefined {
  return COLUMN_CONFIG.find(col => col.id === id);
}
