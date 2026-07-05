/**
 * Transition switcher (transition-library 01): `◀ [name ★] 2/3 ▶`
 * navigation through a pair's Transitions, creation-ordered. ▶ past the
 * last take reads as "new". Inline rename (click the name; Enter commits,
 * Esc reverts), favorite star, and a two-step inline delete (no modal).
 */
import { useEffect, useRef, useState } from 'react';
import { useConfirmFlag } from '../hooks/useConfirmFlag';
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
  // Two-step delete arms then auto-disarms (~3s) — no focus involved
  // (keyboard-focus 01: the no-focus rule killed the old onBlur reset).
  const { armed: confirming, fire: fireDelete, disarm } = useConfirmFlag();
  const inputRef = useRef<HTMLInputElement>(null);

  // Editing/confirm state is per-Transition: navigation resets both
  // (adjust-during-render pattern, same as DeckCard's BPM draft).
  const [seenKey, setSeenKey] = useState(`${active}:${items.length}`);
  const navKey = `${active}:${items.length}`;
  if (navKey !== seenKey) {
    setSeenKey(navKey);
    setDraft(null);
    disarm();
  }

  // Select-all exactly ONCE when editing starts — keying this on the draft
  // VALUE re-selected on every keystroke, so the next key wiped the field.
  const editing = draft !== null;
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

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
      {/* ▶ mirrors ◀ directly after the name: `◀ name ▶/+ (1/2) | ★ del` */}
      <button
        title={atEnd ? (canNew ? 'New Transition' : 'Already on a fresh Transition') : 'Next Transition'}
        disabled={atEnd && !canNew}
        onClick={() => onNavigate(1)}
      >
        {atEnd ? '+' : '▶'}
      </button>
      <span className="editor-switcher-pos" title="Position (creation order)">
        ({active + 1}/{items.length})
      </span>
      <button
        className={`editor-switcher-star${item.favorite ? ' on' : ''}`}
        aria-pressed={!!item.favorite}
        title={item.favorite ? 'Unfavorite' : 'Favorite: this Transition is a keeper'}
        onClick={onToggleFavorite}
      >
        {item.favorite ? '★' : '☆'}
      </button>
      <button
        className={`editor-switcher-del${confirming ? ' confirming' : ''}`}
        title={
          confirming
            ? 'Click again to delete this Transition'
            : 'Delete this Transition (two-step)'
        }
        onClick={() => {
          if (fireDelete()) onDelete();
        }}
      >
        {confirming ? 'sure?' : 'del'}
      </button>
    </span>
  );
}
