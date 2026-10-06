import { useEffect, useState, type CSSProperties } from 'react';
import type { AppMode } from './TopBar';
import { hasKeyboardOverlay, isTypingTarget } from './performance/performanceKeys';
import {
  isKeyboardHelpOpen,
  setKeyboardHelpOpen,
  useKeyboardHelpOpen,
} from './keyboardHelpStore';
import {
  KEYBOARD_ROWS,
  keyboardActions,
  type KeyboardHelpScope,
} from './keyboardShortcutModel';
import './keyboardShortcutOverlay.css';

const SCOPES: { id: KeyboardHelpScope; label: string }[] = [
  { id: 'global', label: 'Global' },
  { id: 'performance', label: 'Performance' },
  { id: 'library', label: 'Library' },
  { id: 'editors', label: 'Editors' },
];

const scopeForMode = (mode: AppMode): KeyboardHelpScope =>
  mode === 'performance' ? 'performance' : mode === 'library' ? 'library' :
    mode === 'transition' || mode === 'routine' ? 'editors' : 'global';

export function KeyboardShortcutOverlay({ mode }: { mode: AppMode }) {
  const open = useKeyboardHelpOpen();
  const [scopeOverride, setScopeOverride] = useState<KeyboardHelpScope | null>(null);
  const scope = scopeOverride ?? scopeForMode(mode);
  const close = () => {
    setScopeOverride(null);
    setKeyboardHelpOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const toggle = event.key === '?' || event.key === 'F1';
      if (isKeyboardHelpOpen()) {
        if (event.key === 'Tab') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (toggle || event.key === 'Escape') {
          setScopeOverride(null);
          setKeyboardHelpOpen(false);
        }
        return;
      }
      if (!toggle || isTypingTarget(event) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (hasKeyboardOverlay()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setKeyboardHelpOpen(true);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  if (!open) return null;
  const actions = keyboardActions(scope);
  return (
    <div className="keyboard-map-backdrop" onMouseDown={close}>
      <section
        className="keyboard-map"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div><span>KEYBOARD MAP</span><strong>{SCOPES.find((item) => item.id === scope)!.label}</strong></div>
          <button className="btn btn-secondary" onClick={close}>Close [Esc]</button>
        </header>
        <nav aria-label="Keyboard shortcut scope">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              className={`btn${scope === item.id ? ' btn-selected' : ''}`}
              aria-pressed={scope === item.id}
              onClick={() => setScopeOverride(item.id)}
            >{item.label}</button>
          ))}
        </nav>
        <div className="keyboard-map-board">
          {KEYBOARD_ROWS.map((row, rowIndex) => (
            <div className="keyboard-map-row" key={rowIndex}>
              {row.map((keyboardKey) => {
                const legends = actions.get(keyboardKey.id) ?? [];
                return (
                  <div
                    className={`keyboard-map-key${legends.length ? ' mapped' : ''}`}
                    style={{ '--key-width': keyboardKey.width ?? 1 } as CSSProperties}
                    key={keyboardKey.id}
                  >
                    <kbd>{keyboardKey.label}</kbd>
                    <div>{legends.map((legend, i) => (
                      <span key={`${legend.action}:${i}`}>
                        {legend.modifier && <em>{legend.modifier}</em>}{legend.action}
                      </span>
                    ))}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p>Actions follow the selected scope. Hold-style controls release on keyup; “+ mouse” controls use pointer movement.</p>
      </section>
    </div>
  );
}
