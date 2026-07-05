/**
 * Deck tag popover (perf-layout 02): click the TRACK zone's tag row to
 * toggle tags in place. This is the deck-side reuse of the library
 * TagEditor's tag-toggling idiom WITHOUT the rest of its panel — title/
 * artist/energy/BPM already live on the TRACK zone, so mounting the whole
 * editor would duplicate controls.
 *
 * Keyboard: the filter input holds focus for the popover's whole life —
 * the performance key hub guards typing targets (performanceKeys.ts), so
 * deck keys can't fire while tagging. ↑/↓ move the highlight, Enter
 * toggles it (popover stays open for multi-tagging), Escape closes,
 * clicking outside the anchor row closes. Every toggle saves instantly
 * through the caller's commit (tag_ids PATCH + cache invalidation).
 *
 * Remount with key={track.id}: the selected set seeds from the track once
 * per mount, then local toggles are the optimistic truth.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { getTagColor } from '../../utils/colorUtils';
import type { Tag, Track } from '../../types';

export function TagPopover({
  track,
  anchorRef,
  commit,
  onClose,
}: {
  track: Track;
  /** The anchor row (contains this popover) — clicks inside it don't close. */
  anchorRef: RefObject<HTMLDivElement | null>;
  commit: (tagIds: number[]) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(track.tags.map((t) => t.id))
  );

  const { data: allTags } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: api.tags.listAll,
  });

  const sorted = useMemo(
    () =>
      [...(allTags ?? [])].sort(
        (a, b) =>
          (a.category?.display_order ?? 0) - (b.category?.display_order ?? 0) ||
          a.display_order - b.display_order ||
          a.id - b.id
      ),
    [allTags]
  );

  const filtered = useMemo(
    () =>
      query.trim()
        ? sorted.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
        : sorted,
    [sorted, query]
  );

  const groups = useMemo(() => {
    const map = new Map<number, { name: string; tags: Tag[] }>();
    for (const tag of filtered) {
      const group = map.get(tag.category_id) ?? {
        name: tag.category?.name ?? 'Other',
        tags: [],
      };
      group.tags.push(tag);
      map.set(tag.category_id, group);
    }
    return [...map.entries()];
  }, [filtered]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click outside the anchor row closes (the popover lives inside the row,
  // so the row's own open-toggle clicks don't fight the close).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [anchorRef, onClose]);

  const toggle = (tag: Tag) => {
    const next = new Set(selected);
    if (next.has(tag.id)) next.delete(tag.id);
    else next.add(tag.id);
    setSelected(next);
    commit([...next]);
    inputRef.current?.focus(); // keep the typing-target shield up
  };

  return (
    <div
      className="perf-tagpop"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <input
        ref={inputRef}
        className="perf-tagpop-search"
        placeholder="Filter tags…"
        value={query}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          // Typing re-anchors the highlight to the best match; clearing drops it.
          setHighlight(q.trim() ? 0 : -1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(filtered.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(-1, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlight >= 0 && filtered[highlight]) toggle(filtered[highlight]);
          }
        }}
      />
      <div className="perf-tagpop-groups">
        {groups.map(([categoryId, group]) => (
          <div key={categoryId} className="perf-tagpop-group">
            <span className="perf-tagpop-cat">{group.name}</span>
            <div className="perf-tagpop-tags">
              {group.tags.map((tag) => {
                const on = selected.has(tag.id);
                const highlighted = highlight >= 0 && filtered[highlight]?.id === tag.id;
                return (
                  <button
                    key={tag.id}
                    className={`perf-tagpop-tag${on ? ' on' : ''}`}
                    style={{
                      borderColor: on ? getTagColor(tag) : undefined,
                      color: on ? getTagColor(tag) : undefined,
                      // Red glow = Enter would remove; peach = would add.
                      boxShadow: highlighted
                        ? `0 0 4px 1px ${on ? 'var(--red)' : 'var(--peach)'}`
                        : undefined,
                    }}
                    onClick={() => toggle(tag)}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <span className="perf-tagpop-empty">no tags match</span>
        )}
      </div>
    </div>
  );
}
