import './PlaylistStatusBadge.css';

export type PlaylistStatus = 'synced' | 'unsynced' | 'partial';

interface PlaylistStatusBadgeProps {
  status: PlaylistStatus;
}

export function PlaylistStatusBadge({ status }: PlaylistStatusBadgeProps) {
  const config = {
    // Compares track lists by name and order only. Never audio, cues or fields, so never green.
    synced: { color: 'var(--accent)', label: 'Same list', hint: 'Same tracks in the same order, compared by name. Audio, cues and fields are not compared.' },
    unsynced: { color: 'var(--danger)', label: 'Differs', hint: 'The track lists differ between libraries.' },
    partial: { color: 'var(--energy-2)', label: 'One library', hint: 'Only one library has this playlist.' }
  }[status];

  return (
    <div className="status-badge" title={config.hint}>
      <span
        className="status-dot"
        style={{ backgroundColor: config.color }}
      />
      <span className="status-label">{config.label}</span>
    </div>
  );
}
