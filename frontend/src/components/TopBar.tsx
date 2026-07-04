/**
 * Persistent top bar: brand, icon mode switch (Library / Performance /
 * Transition editor / Sync), and the active section's title. Visible in
 * every mode.
 */
import './TopBar.css';

export type AppMode = 'library' | 'performance' | 'transition' | 'sync';

const MODES: { id: AppMode; icon: string; title: string }[] = [
  { id: 'library', icon: '≡', title: 'Library' },
  { id: 'performance', icon: '▸', title: 'Performance' },
  { id: 'transition', icon: '⋈', title: 'Transition editor' },
  { id: 'sync', icon: '⇄', title: 'Sync' },
];

export function TopBar({
  mode,
  onModeChange,
}: {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
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
    </header>
  );
}
