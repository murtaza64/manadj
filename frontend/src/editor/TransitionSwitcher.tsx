/**
 * Transition switcher (transition-library 01): `◀ [name ★] 2/3 ▶`
 * navigation through a pair's Transitions, creation-ordered. ▶ past the
 * last take reads as "new". Inline rename (click the name; Enter commits,
 * Esc reverts), favorite star, and a two-step inline delete (no modal).
 */
import { useEffect, useRef, useState } from 'react';
import { isPristine } from './pairStore';
import type { SavedTransition } from './pairStore';

export function TransitionSwitcher({
  items,
  active,
  onNavigate,
  onRename,
  onToggleFavorite,
  onDelete,
}: {
  items: SavedTransition[];
  active: number;
  onNavigate: (dir: -1 | 1) => void;
  onRename: (name: string) => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const item = items[active];
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Editing/confirm state is per-Transition: navigation resets both
  // (adjust-during-render pattern, same as DeckCard's BPM draft).
  const [seenKey, setSeenKey] = useState(`${active}:${items.length}`);
  const navKey = `${active}:${items.length}`;
  if (navKey !== seenKey) {
    setSeenKey(navKey);
    setDraft(null);
    setConfirming(false);
  }

  useEffect(() => {
    if (draft !== null) inputRef.current?.select();
  }, [draft]);

  if (!item) return null;

  const atEnd = active === items.length - 1;
  // ▶ past the last = new take — unless the current one is already the
  // untouched fresh one (creating another would be a visual no-op).
  const canNew = atEnd && !isPristine(item);

  return (
    <span className="editor-switcher">
      <button
        title="Previous Transition"
        disabled={active === 0}
        onClick={() => onNavigate(-1)}
      >
        ◀
      </button>
      {draft === null ? (
        <button
          className="editor-switcher-name"
          title="Rename (click)"
          onClick={() => setDraft(item.name)}
        >
          {item.name}
        </button>
      ) : (
        <input
          ref={inputRef}
          className="editor-switcher-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRename(draft);
              setDraft(null);
            } else if (e.key === 'Escape') {
              setDraft(null);
            }
          }}
        />
      )}
      <button
        className={`editor-switcher-star${item.favorite ? ' on' : ''}`}
        aria-pressed={!!item.favorite}
        title={item.favorite ? 'Unfavorite (proven move)' : 'Favorite: mark as a proven move'}
        onClick={onToggleFavorite}
      >
        {item.favorite ? '★' : '☆'}
      </button>
      <span className="editor-switcher-pos" title="Position (creation order)">
        {active + 1}/{items.length}
      </span>
      <button
        title={atEnd ? (canNew ? 'New Transition' : 'Already on a fresh Transition') : 'Next Transition'}
        disabled={atEnd && !canNew}
        onClick={() => onNavigate(1)}
      >
        {atEnd ? '+' : '▶'}
      </button>
      <button
        className={`editor-switcher-del${confirming ? ' confirming' : ''}`}
        title={
          confirming
            ? 'Click again to delete this Transition'
            : 'Delete this Transition (two-step)'
        }
        onClick={() => {
          if (confirming) {
            setConfirming(false);
            onDelete();
          } else {
            setConfirming(true);
          }
        }}
        onBlur={() => setConfirming(false)}
      >
        {confirming ? 'sure?' : 'del'}
      </button>
    </span>
  );
}
