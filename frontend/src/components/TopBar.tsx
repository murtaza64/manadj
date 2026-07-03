/**
 * Persistent top bar: brand, icon mode switch (Library / Performance /
 * Transition editor), the active section's title, playlist sync. Visible in
 * all three modes; Sync opens its own full-screen flow.
 */
import './TopBar.css';

export type AppMode = 'library' | 'performance' | 'transition';

const MODES: { id: AppMode; icon: string; title: string }[] = [
  { id: 'library', icon: '≡', title: 'Library' },
  { id: 'performance', icon: '▸', title: 'Performance' },
  { id: 'transition', icon: '⋈', title: 'Transition editor' },
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
            title={m.title}
            onClick={() => onModeChange(m.id)}
          >
            {m.icon}
          </button>
        ))}
      </nav>
      <h1 className="topbar-title">{MODES.find((m) => m.id === mode)?.title}</h1>
      <button className="topbar-sync" onClick={onOpenSync} title="Playlist sync">
        <span className="topbar-sync-icon">⟳</span> Sync
      </button>
    </header>
  );
}
