// Column configuration - single source of truth for table layout
export interface ColumnConfig {
  id: string;
  width: number;
  sticky?: boolean;
  align?: 'left' | 'right';
  showShadow?: boolean; // Show shadow on right edge (for last sticky column)
}

export const COLUMN_CONFIG: ColumnConfig[] = [
  { id: 'key', width: 35, sticky: true, align: 'right' },
  { id: 'bpm', width: 35, sticky: true },
  { id: 'energy', width: 35, sticky: true },
  { id: 'title', width: 180, sticky: true, showShadow: true },
  { id: 'artist', width: 180 },
  { id: 'created_at', width: 75, align: 'right' },
  { id: 'quality', width: 80, align: 'right' },
  { id: 'size', width: 60, align: 'right' },
  { id: 'provenance', width: 90 },
  { id: 'tags', width: 300 },
];

// Calculate sticky left positions
export function getStickyLeft(columnIndex: number): number {
  let left = 0;
  for (let i = 0; i < columnIndex; i++) {
    if (COLUMN_CONFIG[i].sticky) {
      left += COLUMN_CONFIG[i].width;
    }
  }
  return left;
}

// Get column by id
export function getColumnConfig(id: string): ColumnConfig | undefined {
  return COLUMN_CONFIG.find(col => col.id === id);
}
