// The whole lifecycle in one cell (gh#342): get → queued → downloading →
// fix ▾ → ✓ via. Shared by the Source Item table and Spotify feed rows.
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { SourceItem } from '../../types';
import { useToast } from '../Toast';
import { errorKindLabel, needsTarget } from './format';
import { useInvalidateItems } from './useItems';
import { useSuppliers } from './useSuppliers';

import type { Panel } from './panels';

/** The whole lifecycle in one cell. */
export function StatusCell({
  item: i,
  panel,
  onToggle,
  soulseekAvailable,
  compact = false,
}: {
  item: SourceItem;
  panel: Panel | null;
  onToggle?: (p: Panel) => void;
  soulseekAvailable: boolean;
  compact?: boolean;
}) {
  const invalidate = useInvalidateItems();
  const toast = useToast();
  const { soundcloud: soundcloudAvailable } = useSuppliers();
  // "get" = a SoundCloud download: needs SoundCloud connected and an item
  // that has a SoundCloud address (Spotify-origin items have none)
  const gettable = soundcloudAvailable && i.source === 'soundcloud';
  const queue = useMutation({ mutationFn: () => api.acquisition.queueDownload(i.id), onSuccess: invalidate, onError: e => toast((e as Error).message) });
  const cancel = useMutation({ mutationFn: () => api.acquisition.cancelDownload(i.id), onSuccess: invalidate, onError: e => toast((e as Error).message) });
  const ignore = useMutation({ mutationFn: () => api.acquisition.ignoreItem(i.id), onSuccess: invalidate });
  const restore = useMutation({ mutationFn: () => api.acquisition.restoreItem(i.id), onSuccess: invalidate });
  const auto = useMutation({ mutationFn: () => api.acquisition.soulseekAuto(i.id), onSuccess: invalidate, onError: e => toast((e as Error).message) });
  const busy = queue.isPending || cancel.isPending || auto.isPending;
  const caret = (p: Panel) => (panel === p ? '▴' : '▾');
  const proposed = i.stage === 'new' && i.correspondence?.status === 'proposed';
  const dl = i.download;

  return (
    <span className="acq-cell">
      {i.stage === 'new' && !proposed && (
        <>
          {gettable && (
            <button className="btn btn-mini btn-primary" disabled={busy} onClick={() => queue.mutate()}>⇣ get</button>
          )}
          {!gettable && soulseekAvailable && (
            <button className="btn btn-mini btn-primary" disabled={busy} onClick={() => auto.mutate()} title="hands-off Soulseek: best mp3, walk peers on failure">⚡ auto</button>
          )}
          {!gettable && !soulseekAvailable && <span className="acq-sub" title="connect SoundCloud or Soulseek in Settings → Accounts">no supplier</span>}
          {soulseekAvailable && onToggle && (
            <button className={`acq-cell-btn acq-cell-slsk${panel === 'soulseek' ? ' open' : ''}`} onClick={() => onToggle('soulseek')} title="search Soulseek for this track">
              ⌕ slsk {caret('soulseek')}
            </button>
          )}
          {!compact && <button className="acq-cell-x" disabled={ignore.isPending} onClick={() => ignore.mutate()} title="ignore">✕</button>}
        </>
      )}
      {proposed && onToggle && (
        <button className={`acq-cell-btn acq-cell-match${panel === 'match' ? ' open' : ''}`} onClick={() => onToggle('match')}>
          ≈ match {Math.round((i.correspondence?.score ?? 0) * 100)}% {caret('match')}
        </button>
      )}
      {i.stage === 'queued' && (
        <>
          <span className="acq-badge acq-badge-queued">queued · {dl?.via ?? 'soundcloud'}</span>
          <button className="acq-cell-x" disabled={cancel.isPending} onClick={() => cancel.mutate()} title="cancel">✕</button>
        </>
      )}
      {i.stage === 'downloading' && (
        <span className={`acq-badge acq-badge-downloading acq-via-${dl?.via}`}>
          ⇣ {dl?.via}
          {dl?.attempt != null && dl.attempts_total != null && dl.attempts_total > 1 && ` · ${dl.attempt}/${dl.attempts_total}`}
        </span>
      )}
      {i.stage === 'failed' && dl?.cooling_down_until && (
        <span className="acq-badge acq-badge-cooling" title="rate-limited; retries automatically">
          cooling until {new Date(dl.cooling_down_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
      {needsTarget(i) && (
        <>
          {onToggle ? (
            <button className={`acq-cell-btn acq-cell-fix${panel === 'soulseek' ? ' open' : ''}`} onClick={() => onToggle('soulseek')}>
              ✕ {errorKindLabel(i.error_kind, i)} · fix {caret('soulseek')}
            </button>
          ) : (
            <span className="acq-cell-btn acq-cell-fix">✕ {errorKindLabel(i.error_kind, i)}</span>
          )}
          {soulseekAvailable && (
            <button className="btn btn-mini btn-primary" disabled={busy} onClick={() => auto.mutate()} title="hands-off: best mp3, walk peers on failure">
              ⚡ auto
            </button>
          )}
        </>
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

