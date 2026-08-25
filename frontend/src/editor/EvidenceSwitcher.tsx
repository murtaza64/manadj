/**
 * Evidence switcher (gh#167, superseding transition-library 01's
 * TransitionSwitcher): ONE cycler over the loaded pair's evidence —
 * `◀ [active] ▾ ▶/+ (n/m) ★ del`. Only the ACTIVE evidence shows as a
 * chip (saved Transitions carry their name, ★ when favorite; Takes a
 * ● + detection time; the Set-pin fact rides the tooltips, no glyph);
 * the ▾ opens the full evidence list (ContextMenu — the Set pin picker's
 * idiom) for direct jumps. ◀/▶ cycle neighbors; ▶ past the last = new pristine Transition.
 * Clicking the active Transition chip renames inline (Enter commits, Esc
 * reverts). Favorite star and the two-step delete act on the active saved
 * Transition only — on a Take they render DISABLED, never unmounted, and
 * every segment has a fixed width: the switcher never moves or resizes
 * when the evidence kind changes (human feedback on the first cut — the
 * take-review UI gets reserved space, not a layout jump).
 */
import { useEffect, useRef, useState } from 'react';
import ContextMenu, { type MenuItem } from '../components/ContextMenu';
import { useConfirmFlag } from '../hooks/useConfirmFlag';
import type { EvidenceItem } from './evidence';

function takeTime(detectedAt?: string): string {
  if (!detectedAt) return 'Take';
  // Server stamps are naive UTC — pin the zone (pairStore's rule).
  const ms = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(detectedAt) ? detectedAt : `${detectedAt}Z`);
  if (Number.isNaN(ms)) return 'Take';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function chipText(item: EvidenceItem): string {
  if (item.kind === 'take') return `● ${takeTime(item.detectedAt)}`;
  return `${item.favorite ? '★ ' : ''}${item.name ?? ''}`;
}

export function EvidenceSwitcher({
  items,
  activeIndex,
  canNew,
  onSelect,
  onNew,
  onRename,
  onToggleFavorite,
  onDelete,
}: {
  items: EvidenceItem[];
  /** Index of the loaded evidence in `items` (-1 while nothing matches —
   * transient states only). */
  activeIndex: number;
  /** ▶ past the last item may create a fresh Transition (false when the
   * active one IS already the untouched fresh one). */
  canNew: boolean;
  onSelect: (item: EvidenceItem) => void;
  onNew: () => void;
  /** Active saved Transition only (the take banner owns Take verbs). */
  onRename: (name: string) => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  const active = activeIndex >= 0 ? items[activeIndex] : undefined;
  const [draft, setDraft] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Two-step delete arms then auto-disarms (~3s) — no focus involved
  // (keyboard-focus 01: the no-focus rule killed the old onBlur reset).
  const { armed: confirming, fire: fireDelete, disarm } = useConfirmFlag();
  const inputRef = useRef<HTMLInputElement>(null);

  // Editing/confirm state is per-evidence: navigation resets both
  // (adjust-during-render pattern, same as DeckCard's BPM draft).
  const [seenKey, setSeenKey] = useState(`${activeIndex}:${items.length}`);
  const navKey = `${activeIndex}:${items.length}`;
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

  if (items.length === 0) return null;

  const atEnd = activeIndex >= items.length - 1;
  const activeIsSaved = active?.kind === 'transition';

  // The full evidence list, ★/● glyphs and a ✓ on the loaded one — the
  // Set pin picker's vocabulary (SetDetailPane), same menu component; the
  // Set-pin fact rides each item's tooltip.
  const menuItems: MenuItem[] = items.map((item, i) => ({
    label:
      (item.kind === 'take'
        ? `● Take · ${takeTime(item.detectedAt)}`
        : `${item.favorite ? '★ ' : ''}${item.name ?? ''}`) +
      (i === activeIndex ? ' ✓' : ''),
    title: item.pinned ? 'Set-pinned here' : undefined,
    separatorBefore: i > 0 && item.kind === 'take' && items[i - 1].kind === 'transition',
    onSelect: () => {
      if (i !== activeIndex) onSelect(item);
    },
  }));

  return (
    <span className="editor-switcher">
      <button
        className="editor-switcher-nav"
        title="Previous evidence"
        disabled={activeIndex <= 0}
        onClick={() => onSelect(items[activeIndex - 1])}
      >
        ◀
      </button>
      {active && draft === null && (
        <button
          className={`editor-switcher-name${active.kind === 'take' ? ' take' : ''}`}
          title={
            active.kind === 'transition'
              ? 'Rename (click)'
              : `The Take under review${active.pinned ? ' (Set-pinned here)' : ''}`
          }
          onClick={() => {
            if (active.kind === 'transition') setDraft(active.name ?? '');
          }}
        >
          {chipText(active)}
        </button>
      )}
      {active && draft !== null && (
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
        className="editor-switcher-browse"
        title="Browse this pair's evidence (saved Transitions, then Takes)"
        onClick={(e) => setMenuPos({ x: e.clientX, y: e.clientY })}
      >
        ▾
      </button>
      {/* ▶ mirrors ◀ after the chip: `◀ name ▾ ▶/+ (1/2) | ★ del` */}
      <button
        className="editor-switcher-nav"
        title={
          atEnd ? (canNew ? 'New Transition' : 'Already on a fresh Transition') : 'Next evidence'
        }
        disabled={atEnd ? !canNew : activeIndex < 0}
        onClick={() => (atEnd ? onNew() : onSelect(items[activeIndex + 1]))}
      >
        {atEnd ? '+' : '▶'}
      </button>
      <span
        className="editor-switcher-pos"
        title="Position (saved first — favorites lead — then Takes, newest first)"
      >
        ({activeIndex + 1}/{items.length})
      </span>
      {/* Always mounted, disabled on a Take — the switcher never resizes
          when the evidence kind changes. */}
      <button
        className={`editor-switcher-star${activeIsSaved && active?.favorite ? ' on' : ''}`}
        aria-pressed={activeIsSaved && !!active?.favorite}
        disabled={!activeIsSaved}
        title={
          !activeIsSaved
            ? 'Takes cannot be favorited — promote first'
            : active?.favorite
              ? 'Unfavorite'
              : 'Favorite: this Transition is a keeper'
        }
        onClick={onToggleFavorite}
      >
        {activeIsSaved && active?.favorite ? '★' : '☆'}
      </button>
      <button
        className={`editor-switcher-del${confirming ? ' confirming' : ''}`}
        disabled={!activeIsSaved}
        title={
          !activeIsSaved
            ? 'Takes are managed from the review banner (Discard) or history'
            : confirming
              ? 'Click again to delete this Transition'
              : 'Delete this Transition (two-step)'
        }
        onClick={() => {
          if (fireDelete()) onDelete();
        }}
      >
        {confirming ? 'sure?' : 'del'}
      </button>
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </span>
  );
}
