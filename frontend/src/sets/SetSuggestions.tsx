/**
 * Set-building suggestion popover (sets 10): ranked Track proposals for
 * the Set toolbar's Suggest (append after the last Track) and the
 * per-adjacency insert affordance. Ranking is the pure Follow-tier module
 * (follow/suggest.ts); this component only wires evidence sources —
 * the transition index (direction-aware), Links, and the library list —
 * and renders the top of the ranking. Tracks already in the Set never
 * appear; hopeless candidates (weakest edge = "Other matches") are cut.
 *
 * Accepting a suggestion adds the Track only — pins arrive via the usual
 * auto-fill offer on the new adjacencies (issue 02's affordances).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track } from '../types';
import { formatKeyDisplay } from '../utils/keyUtils';
import { clampToViewport } from '../components/ContextMenu';
import { tierLabel } from '../follow/model';
import {
  suggestAppend,
  suggestInsert,
  weakerTier,
  type EdgeKnownLookup,
} from '../follow/suggest';
import { knownStrengthOf } from '../links/known';
import { useLinks } from '../links/linkStore';
import {
  transitionsFrom,
  transitionsInto,
  useTransitionIndex,
} from '../editor/transitionIndex';
import './SetSuggestions.css';

/** Tier 7 = "Other matches" — not worth suggesting from a whole-library
 * candidate pool (Follow mode's rest tier is post-filter; ours is not). */
const REST_TIER = 7;
const MAX_ROWS = 20;

export type SuggestTarget =
  | { kind: 'append'; last: Track }
  | { kind: 'insert'; predecessor: Track; successor: Track; insertIndex: number };

interface SuggestionRow {
  track: Track;
  /** Edge tier labels to chip: one for append, out/in for insert. */
  edges: string[];
  known: boolean;
}

interface SetSuggestionsProps {
  x: number;
  y: number;
  target: SuggestTarget;
  inSetIds: ReadonlySet<number>;
  onAccept: (trackId: number) => void;
  onClose: () => void;
}

export default function SetSuggestions({
  x,
  y,
  target,
  inSetIds,
  onAccept,
  onClose,
}: SetSuggestionsProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  const index = useTransitionIndex();
  const links = useLinks();
  const { data: candidates } = useQuery({
    queryKey: ['tracks', 'set-suggestions'],
    queryFn: () => api.tracks.list(1, 1000),
    select: (data): Track[] => data.items ?? [],
  });

  // ── Positioning + dismissal (ContextMenu's pattern) ──────────────────
  const loaded = candidates !== undefined;
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition(clampToViewport(x, y, rect.width, rect.height, window.innerWidth, window.innerHeight));
  }, [x, y, loaded]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [onClose]);

  // ── Ranking (pure module; evidence lookups built here) ───────────────
  const knownOutOf = (anchorId: number): EdgeKnownLookup => {
    const fromAnchor = transitionsFrom(index, anchorId);
    return (id) => knownStrengthOf(fromAnchor, links, anchorId, id);
  };
  const knownInto = (anchorId: number): EdgeKnownLookup => {
    const intoAnchor = transitionsInto(index, anchorId);
    return (id) => knownStrengthOf(intoAnchor, links, anchorId, id);
  };

  let rows: SuggestionRow[] = [];
  if (candidates) {
    if (target.kind === 'append') {
      rows = suggestAppend(candidates, inSetIds, target.last, knownOutOf(target.last.id))
        .filter((s) => s.tier < REST_TIER)
        .slice(0, MAX_ROWS)
        .map((s) => ({ track: s.track, edges: [tierLabel(s.tier)], known: s.tier <= 2 }));
    } else {
      rows = suggestInsert(
        candidates,
        inSetIds,
        target.predecessor,
        target.successor,
        knownOutOf(target.predecessor.id),
        knownInto(target.successor.id)
      )
        .filter((s) => weakerTier(s) < REST_TIER)
        .slice(0, MAX_ROWS)
        .map((s) => ({
          track: s.track,
          edges: [`out: ${tierLabel(s.outTier)}`, `in: ${tierLabel(s.inTier)}`],
          known: Math.min(s.outTier, s.inTier) <= 2,
        }));
    }
  }

  const heading =
    target.kind === 'append'
      ? `Append after “${target.last.title ?? `Track ${target.last.id}`}”`
      : `Insert between “${target.predecessor.title ?? `Track ${target.predecessor.id}`}” and “${
          target.successor.title ?? `Track ${target.successor.id}`
        }”`;

  return (
    <div
      ref={panelRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 1000,
        width: '420px',
        maxHeight: '360px',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--mantle)',
        border: '1px solid var(--surface1)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        fontSize: '12px',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--surface0)',
          color: 'var(--subtext1)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {heading}
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {candidates === undefined ? (
          <div style={{ padding: '10px', color: 'var(--subtext1)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '10px', color: 'var(--subtext1)' }}>
            No suggestions — no known or key-compatible candidates outside the set.
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.track.id}
              className="set-suggestion-row"
              onClick={() => {
                onAccept(row.track.id);
                onClose();
              }}
              title="Add to set (pins via the auto-fill offer)"
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ color: 'var(--text)' }}>
                  {row.track.title ?? `Track ${row.track.id}`}
                </span>
                {row.track.artist && (
                  <span style={{ color: 'var(--subtext0)', marginLeft: '6px' }}>
                    {row.track.artist}
                  </span>
                )}
              </span>
              <span style={{ width: '32px', color: 'var(--sapphire)' }}>
                {formatKeyDisplay(row.track.key ?? null)}
              </span>
              <span style={{ width: '40px', color: 'var(--subtext1)', textAlign: 'right' }}>
                {row.track.bpm ? row.track.bpm.toFixed(0) : '—'}
              </span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: '1px',
                  color: row.known ? 'var(--green)' : 'var(--subtext0)',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.edges.map((edge) => (
                  <span key={edge}>{edge}</span>
                ))}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
