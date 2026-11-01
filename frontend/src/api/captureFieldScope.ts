import { api } from './client';
import type { Track } from '../types';

export async function captureActiveLibraryIds(): Promise<number[]> {
  const result = await api.tracks.list(1, 10000);
  if (!Array.isArray(result.items) || !Number.isInteger(result.total) || result.total > result.items.length) throw new Error('Cannot capture the complete Library scope (maximum10000). Narrow the filter.');
  return result.items.map((track: Track) => track.id);
}
