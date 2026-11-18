// The wishlist lifecycle in one cell: new → find on Beatport ↗ / ignore,
// ≈ match review, ✓ via, restore. Shared by the Source Item table and
// Spotify feed rows.
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SourceItem } from '../../types';
import { useInvalidateItems } from './useItems';

import type { Panel } from './panels';

/** The whole lifecycle in one cell. */
export function StatusCell({
  item: i,
  panel,
  onToggle,
  compact = false,
}: {
  item: SourceItem;
  panel: Panel | null;
  onToggle?: (p: Panel) => void;
  compact?: boolean;
}) {
  const invalidate = useInvalidateItems();
  const ignore = useMutation({ mutationFn: () => api.acquisition.ignoreItem(i.id), onSuccess: invalidate });
  const restore = useMutation({ mutationFn: () => api.acquisition.restoreItem(i.id), onSuccess: invalidate });
  const caret = (p: Panel) => (panel === p ? '▴' : '▾');
  const proposed = i.stage === 'new' && i.correspondence?.status === 'proposed';

  return (
    <span className="acq-cell">
      {i.stage === 'new' && !proposed && (
        <>
          {i.beatport_url && (
            <a
              className="btn btn-mini btn-primary"
              href={i.beatport_url}
              target="_blank"
              rel="noreferrer"
              title="search Beatport for a legitimate copy"
            >
              find on Beatport ↗
            </a>
          )}
          {!compact && <button className="acq-cell-x" disabled={ignore.isPending} onClick={() => ignore.mutate()} title="ignore">✕</button>}
        </>
      )}
      {proposed && onToggle && (
        <button className={`acq-cell-btn acq-cell-match${panel === 'match' ? ' open' : ''}`} onClick={() => onToggle('match')}>
          ≈ match {Math.round((i.correspondence?.score ?? 0) * 100)}% {caret('match')}
        </button>
      )}
      {i.stage === 'fulfilled' && (
        <button className={`acq-cell-done${panel === 'fulfilled' ? ' open' : ''}`} onClick={() => onToggle?.('fulfilled')} title="corresponds to a library track — click for details">
          ✓ {i.provenance ? (i.provenance.asserted ? `via ${i.provenance.label}` : i.provenance.label) : 'matched'}
          {onToggle && ` ${caret('fulfilled')}`}
        </button>
      )}
      {i.stage === 'ignored' && (
        <button className="btn btn-mini" disabled={restore.isPending} onClick={() => restore.mutate()}>restore</button>
      )}
    </span>
  );
}
