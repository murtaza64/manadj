export type PlaylistStatus = 'synced' | 'unsynced' | 'partial';

interface PlaylistStatusBadgeProps {
  status: PlaylistStatus;
}

export function PlaylistStatusBadge({ status }: PlaylistStatusBadgeProps) {
  const config = {
    synced: { color: 'var(--green)', label: 'Synced' },
    unsynced: { color: 'var(--red)', label: 'Unsynced' },
    partial: { color: 'var(--energy-2)', label: 'Partial' }
  }[status];

  return (
    <div className="status-badge">
      <span
        className="status-dot"
        style={{ backgroundColor: config.color }}
      />
      <span className="status-label">{config.label}</span>
    </div>
  );
}
