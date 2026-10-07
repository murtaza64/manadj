// Inline panels a table row can open under itself (gh#342).
import type { SourceItem } from '../../types';
import { needsTarget } from './format';

export type Panel = 'soulseek' | 'match' | 'fulfilled';

/** Which inline panel a row carries by default; failed + proposed rows open. */
export function defaultPanel(i: SourceItem): Panel | null {
  if (needsTarget(i)) return 'soulseek';
  if (i.stage === 'new' && i.correspondence?.status === 'proposed') return 'match';
  return null;
}
