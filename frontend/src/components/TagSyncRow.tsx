import type { UnifiedTagView } from '../types';
import './TagSyncRow.css';

interface TagSyncRowProps {
  tag: UnifiedTagView;
}

export function TagSyncRow({ tag }: TagSyncRowProps) {
  // Only show manadj tags (manadj is source of truth)
  if (!tag.manadj) return null;

  // Check per-target sync status
  const engineSynced = tag.engine?.track_count === tag.manadj.track_count;
  const rekordboxSynced = tag.rekordbox?.track_count === tag.manadj.track_count;
  const allSynced = engineSynced && rekordboxSynced;

  return (
    <tr className={`tag-sync-row ${allSynced ? '' : 'tag-sync-row-unsynced'}`}>
      <td className="tag-name-cell">
        <span className="tag-name">{tag.tag_name}</span>
        <span className="tag-track-count">({tag.manadj.track_count} tracks)</span>
      </td>
      <td className="tag-sync-status-cell">
        <span className={`sync-indicator ${engineSynced ? 'sync-indicator-synced' : 'sync-indicator-unsynced'}`}>
          {engineSynced ? '✓' : '✗'}
        </span>
      </td>
      <td className="tag-sync-status-cell">
        <span className={`sync-indicator ${rekordboxSynced ? 'sync-indicator-synced' : 'sync-indicator-unsynced'}`}>
          {rekordboxSynced ? '✓' : '✗'}
        </span>
      </td>
    </tr>
  );
}
