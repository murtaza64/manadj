// Inline panels a table row can open under itself (gh#342).
import type { SourceItem } from '../../types';

export type Panel = 'match' | 'fulfilled';

/** Which inline panel a row carries by default; proposed matches open. */
export function defaultPanel(i: SourceItem): Panel | null {
  if (i.stage === 'new' && i.correspondence?.status === 'proposed') return 'match';
  return null;
}
