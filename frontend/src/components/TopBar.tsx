/**
 * Persistent top bar: brand, three-way mode switch (Library / Performance /
 * Transition editor), playlist sync. Visible in all three modes; Sync opens
 * its own full-screen flow.
 */
import './TopBar.css';

export type AppMode = 'library' | 'performance' | 'transition';

const MODES: { id: AppMode; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'performance', label: 'Performance' },
  { id: 'transition', label: 'Transition editor' },
];

export function TopBar({
  mode,
  onModeChange,
  onOpenSync,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  onOpenSync: () => void;
}) {
  return (
    <header className="topbar">
      <img src="/logo.png" alt="manaDJ logo" className="topbar-logo" />
      <nav className="topbar-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`topbar-mode${mode === m.id ? ' active' : ''}`}
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      <button className="topbar-sync" onClick={onOpenSync} title="Playlist sync">
        <span className="topbar-sync-icon">⟳</span> Sync
      </button>
    </header>
  );
}
