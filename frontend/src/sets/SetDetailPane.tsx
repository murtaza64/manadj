/**
 * The Set detail pane (sets 01+02): replaces the track table on the
 * browse surface when a Set is selected. Ordered track rows (title/
 * artist, key, BPM) with drag-reorder and remove; adds arrive by dropping
 * tracks onto the Set's sidebar row or the pane itself. Scroll position
 * and selection live in the set store — the pane survives mode switches
 * unmoved.
 *
 * Between track rows sit adjacency rows (sets 02): pin chip, evidence
 * counts (N tr · M tk against the Transition library / Take history),
 * and the orthogonal Unresolved ("will hard-cut") and Unpracticed
 * badges. Auto-fill (per-adjacency and set-wide) proposes Transitions
 * only; the manual pin picker also lists the pair's Takes (ADR 0023).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track } from '../types';
import { formatKeyDisplay } from '../utils/keyUtils';
import {
  applyReorder,
  indicatorY,
  insertionIndexFromPointer,
  type RowRect,
} from '../selection/dropIndex';
import {
  isTrackDrag,
  readTrackDragPayload,
  readTrackDragSource,
  setTrackDragPayload,
} from '../selection/trackDrag';
import { useToast } from '../components/Toast';
import ContextMenu, { type MenuItem } from '../components/ContextMenu';
import {
  initTransitionStore,
  snapshotPairStore,
  subscribePairStore,
} from '../editor/pairStore';
import {
  adjacencyView,
  autoFillProposal,
  type AdjacencyPin,
  type TakeEvidence,
  type TransitionEvidence,
} from './adjacency';
import {
  addTracksToSet,
  ensureSetEntriesLoaded,
  getSetScroll,
  insertTrackIntoSet,
  removeTrackFromSet,
  reorderSetEntries,
  setAdjacencyPin,
  setAdjacencyPins,
  setSetScroll,
  useSetEntries,
} from './setStore';
import SetSuggestions, { type SuggestTarget } from './SetSuggestions';

interface SetDetailPaneProps {
  setId: number;
}

export default function SetDetailPane({ setId }: SetDetailPaneProps) {
  const showToast = useToast();
  const entries = useSetEntries(setId);
  useEffect(() => {
    void ensureSetEntriesLoaded(setId);
  }, [setId]);

  const { data: sets = [] } = useQuery({ queryKey: ['sets'], queryFn: api.sets.list });
  const set = sets.find((s) => s.id === setId);

  // ── Adjacency evidence (sets 02) ─────────────────────────────────────
  // Transitions per ordered pair from the pair store (the Transition
  // library's own source of truth); Takes from the history list.
  const pairStore = useSyncExternalStore(subscribePairStore, snapshotPairStore);
  useEffect(() => {
    void initTransitionStore();
  }, []);
  const { data: takes = [] } = useQuery({ queryKey: ['takes'], queryFn: api.takes.list });

  const pairEvidence = (a: number, b: number) => {
    const transitions: TransitionEvidence[] = (pairStore[`${a}:${b}`]?.items ?? []).map((it) => ({
      uuid: it.uuid,
      name: it.name,
      favorite: it.favorite ?? false,
    }));
    const pairTakes: TakeEvidence[] = takes
      .filter((t) => t.a_track_id === a && t.b_track_id === b)
      .map((t) => ({ uuid: t.uuid, detectedAt: t.detected_at }));
    return { transitions, takes: pairTakes };
  };

  // Set-wide auto-fill: one click accepts every proposal on a pin-less
  // adjacency. Existing pins (even dangling ones) are never overwritten.
  const autoFillable = new Map<number, AdjacencyPin>();
  if (entries) {
    for (let i = 0; i < entries.length - 1; i++) {
      if (entries[i].pin !== null) continue;
      const { transitions } = pairEvidence(entries[i].trackId, entries[i + 1].trackId);
      const proposal = autoFillProposal(transitions);
      if (proposal) autoFillable.set(entries[i].trackId, { kind: 'transition', uuid: proposal.uuid });
    }
  }

  // Track metadata for the entry rows (batch-by-Promise.all pattern, as in
  // TakeHistoryView's labels query).
  const trackIds = (entries ?? []).map((e) => e.trackId);
  const { data: trackMap } = useQuery({
    queryKey: ['set-tracks', setId, trackIds.join(',')],
    enabled: trackIds.length > 0,
    queryFn: async () => {
      const tracks = await Promise.all(trackIds.map((id) => api.tracks.getById(id)));
      return new Map<number, Track>(tracks.map((t) => [t.id, t]));
    },
  });

  // ── Scroll persistence (set store — survives mode switches) ──────────
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pane = paneRef.current;
    if (pane) pane.scrollTop = getSetScroll(setId);
    // Restore once the rows exist (first data arrival changes scrollHeight).
  }, [setId, entries !== undefined && trackMap !== undefined]);

  // ── Suggestions (sets 10): toolbar append + per-adjacency insert ─────
  const [suggest, setSuggest] = useState<{ x: number; y: number; target: SuggestTarget } | null>(
    null
  );
  const inSetIds = new Set(trackIds);
  const lastTrack =
    entries && entries.length > 0 ? trackMap?.get(entries[entries.length - 1].trackId) : undefined;

  // ── Drag-reorder (dropIndex helpers, playlist-pane mechanics) ────────
  const [dropIndicator, setDropIndicator] = useState<{ index: number; y: number } | null>(null);

  const rowRects = (pane: HTMLDivElement): RowRect[] => {
    const paneRect = pane.getBoundingClientRect();
    return Array.from(pane.querySelectorAll('[data-set-track-row]')).map((row) => {
      const r = (row as HTMLElement).getBoundingClientRect();
      return { top: r.top - paneRect.top + pane.scrollTop, height: r.height };
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isTrackDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const pane = paneRef.current;
    if (!pane) return;
    const rects = rowRects(pane);
    const pointerY = e.clientY - pane.getBoundingClientRect().top + pane.scrollTop;
    const index = insertionIndexFromPointer(pointerY, rects);
    setDropIndicator({ index, y: indicatorY(index, rects) });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!paneRef.current?.contains(e.relatedTarget as Node)) {
      setDropIndicator(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const indicator = dropIndicator;
    setDropIndicator(null);
    if (!entries) return;
    const droppedIds = readTrackDragPayload(e.dataTransfer);
    if (droppedIds.length === 0) return;

    // In-pane drags reorder; drags from anywhere else append (a Track
    // appears at most once — present drops are skipped with a toast).
    if (readTrackDragSource(e.dataTransfer) === 'set-pane') {
      const orderIds = entries.map((en) => en.trackId);
      const newOrder = applyReorder(orderIds, droppedIds, indicator?.index ?? orderIds.length);
      if (newOrder.join(',') !== orderIds.join(',')) {
        reorderSetEntries(setId, newOrder);
      }
      return;
    }

    void addTracksToSet(setId, droppedIds).then((skipped) => {
      if (skipped > 0) {
        showToast(skipped === 1 ? '1 track already in set' : `${skipped} tracks already in set`);
      }
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Set header strip (mirrors the playlist header) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          borderBottom: '1px solid var(--surface0)',
          background: 'var(--crust)',
        }}
      >
        <span style={{ fontSize: '13px', color: 'var(--text)' }}>
          {set?.color && (
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                background: set.color,
                marginRight: '8px',
              }}
            />
          )}
          {set?.name ?? 'Set'}
          <span style={{ color: 'var(--subtext0)', marginLeft: '8px' }}>
            {entries?.length ?? 0} tracks
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => setAdjacencyPins(setId, autoFillable)}
          disabled={autoFillable.size === 0}
          title={
            autoFillable.size === 0
              ? 'No unresolved adjacency has an unambiguous Transition'
              : 'Pin the proposed Transition on every unresolved adjacency'
          }
          style={{
            padding: '2px 10px',
            background: autoFillable.size > 0 ? 'var(--green)' : 'var(--surface0)',
            color: autoFillable.size > 0 ? 'var(--base)' : 'var(--subtext0)',
            border: '1px solid var(--surface1)',
            cursor: autoFillable.size > 0 ? 'pointer' : 'default',
            fontSize: '12px',
          }}
        >
          Auto-fill {autoFillable.size > 0 ? `(${autoFillable.size})` : ''}
        </button>
        {/* Suggest (sets 10): ranked candidates to append after the last track */}
        <button
          onClick={(e) =>
            lastTrack &&
            setSuggest({ x: e.clientX, y: e.clientY, target: { kind: 'append', last: lastTrack } })
          }
          disabled={!lastTrack}
          title={
            lastTrack
              ? 'Suggest tracks to append, ranked by follow tiering out of the last track'
              : 'Add a track first — suggestions rank out of the last track'
          }
          style={{
            marginLeft: '8px',
            padding: '2px 10px',
            background: lastTrack ? 'var(--blue)' : 'var(--surface0)',
            color: lastTrack ? 'var(--base)' : 'var(--subtext0)',
            border: '1px solid var(--surface1)',
            cursor: lastTrack ? 'pointer' : 'default',
            fontSize: '12px',
          }}
        >
          Suggest
        </button>
        </span>
      </div>

      <div
        ref={paneRef}
        onScroll={(e) => setSetScroll(setId, e.currentTarget.scrollTop)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ position: 'relative', flex: 1, overflow: 'auto' }}
      >
        {dropIndicator && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: Math.max(0, dropIndicator.y - 1),
              height: '2px',
              background: 'var(--blue)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}

        {entries === undefined ? (
          <div style={{ padding: '16px', color: 'var(--subtext1)' }}>Loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--subtext1)' }}>
            Empty set — drag tracks onto the set&apos;s sidebar row to add them.
          </div>
        ) : (
          entries.map((entry, i) => {
            const track = trackMap?.get(entry.trackId);
            const next = entries[i + 1];
            return (
              <div key={entry.trackId}>
                <SetTrackRow
                  index={i}
                  trackId={entry.trackId}
                  track={track}
                  onRemove={() => removeTrackFromSet(setId, entry.trackId)}
                />
                {next && (
                  <AdjacencyRow
                    pin={entry.pin}
                    evidence={pairEvidence(entry.trackId, next.trackId)}
                    onPin={(pin) => setAdjacencyPin(setId, entry.trackId, pin)}
                    onSuggestInsert={(() => {
                      const predecessor = trackMap?.get(entry.trackId);
                      const successor = trackMap?.get(next.trackId);
                      if (!predecessor || !successor) return undefined;
                      return (x: number, y: number) =>
                        setSuggest({
                          x,
                          y,
                          target: { kind: 'insert', predecessor, successor, insertIndex: i + 1 },
                        });
                    })()}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Suggestion popover (sets 10) — accepting adds the Track; pins
          arrive via the usual auto-fill offer on the new adjacencies. */}
      {suggest && (
        <SetSuggestions
          x={suggest.x}
          y={suggest.y}
          target={suggest.target}
          inSetIds={inSetIds}
          onAccept={(trackId) => {
            if (suggest.target.kind === 'append') {
              void addTracksToSet(setId, [trackId]);
            } else {
              insertTrackIntoSet(setId, trackId, suggest.target.insertIndex);
            }
          }}
          onClose={() => setSuggest(null)}
        />
      )}
    </div>
  );
}

/** Pin-chip text per resolved status. */
function pinChip(view: ReturnType<typeof adjacencyView>): { text: string; color: string } {
  if (view.status === 'transition') {
    const star = view.transition!.favorite ? '★ ' : '';
    return { text: `◆ ${star}${view.transition!.name}`, color: 'var(--green)' };
  }
  if (view.status === 'take') {
    const date = new Date(view.take!.detectedAt).toLocaleDateString();
    return { text: `● take · ${date} (unpromoted)`, color: 'var(--mauve)' };
  }
  return { text: '✕ hard cut', color: 'var(--subtext0)' };
}

function AdjacencyRow({
  pin,
  evidence,
  onPin,
  onSuggestInsert,
}: {
  pin: AdjacencyPin | null;
  evidence: { transitions: TransitionEvidence[]; takes: TakeEvidence[] };
  onPin: (pin: AdjacencyPin | null) => void;
  /** Open insert suggestions for this adjacency (sets 10); absent while
   * the pair's track metadata is still loading. */
  onSuggestInsert?: (x: number, y: number) => void;
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const view = adjacencyView(pin, evidence.transitions, evidence.takes);
  const proposal = pin === null ? autoFillProposal(evidence.transitions) : null;
  const chip = pinChip(view);

  // Manual pin picker: the pair's Transitions AND Takes (Takes are never
  // auto-filled — pinning one is always this explicit act, ADR 0023).
  const pickerItems: MenuItem[] = [
    ...evidence.transitions.map((t) => ({
      label: `${t.favorite ? '★ ' : ''}${t.name}${pin?.uuid === t.uuid ? ' ✓' : ''}`,
      onSelect: () => onPin({ kind: 'transition', uuid: t.uuid }),
    })),
    ...evidence.takes.map((t, i) => ({
      label: `Take · ${new Date(t.detectedAt).toLocaleString()}${pin?.uuid === t.uuid ? ' ✓' : ''}`,
      separatorBefore: i === 0 && evidence.transitions.length > 0,
      onSelect: () => onPin({ kind: 'take', uuid: t.uuid }),
    })),
    ...(evidence.transitions.length === 0 && evidence.takes.length === 0
      ? [{ label: 'No transitions or takes for this pair', disabled: true }]
      : []),
    ...(pin !== null
      ? [
          {
            label: 'Unpin (hard cut)',
            danger: true,
            separatorBefore: true,
            onSelect: () => onPin(null),
          },
        ]
      : []),
  ];

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '2px 12px 2px 48px',
          background: 'var(--crust)',
          borderBottom: '1px solid var(--surface0)',
          fontSize: '12px',
        }}
      >
        {/* Pin chip — click opens the manual pin picker */}
        <button
          onClick={(e) => setMenuPos({ x: e.clientX, y: e.clientY })}
          title="Pin a transition or take for this handover"
          style={{
            padding: '1px 8px',
            background: 'var(--surface0)',
            border: '1px solid var(--surface1)',
            color: chip.color,
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {chip.text}
        </button>

        {/* One-click auto-fill accept (Transitions only, favorite first) */}
        {proposal && view.status === 'unresolved' && (
          <button
            onClick={() => onPin({ kind: 'transition', uuid: proposal.uuid })}
            title="Pin the proposed Transition"
            style={{
              padding: '1px 8px',
              background: 'transparent',
              border: '1px dashed var(--green)',
              color: 'var(--green)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            ↳ pin {proposal.favorite ? '★ ' : ''}{proposal.name}
          </button>
        )}

        {/* Orthogonal badges: Unresolved (will hard-cut) · Unpracticed */}
        {view.status === 'unresolved' && (
          <span
            style={{
              padding: '1px 6px',
              background: 'var(--red)',
              color: 'var(--base)',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            UNRESOLVED — will hard-cut
          </span>
        )}
        {view.unpracticed && (
          <span
            style={{
              padding: '1px 6px',
              background: 'var(--yellow)',
              color: 'var(--base)',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            UNPRACTICED
          </span>
        )}

        {/* Evidence counts for the ordered pair */}
        <span style={{ marginLeft: 'auto', color: 'var(--subtext0)' }}>
          {view.counts.transitions} tr · {view.counts.takes} tk
        </span>

        {/* Insert suggestions (sets 10): ranked by the weaker edge */}
        {onSuggestInsert && (
          <button
            onClick={(e) => onSuggestInsert(e.clientX, e.clientY)}
            title="Suggest a track to insert here, ranked by the weaker of the two edges"
            style={{
              padding: '1px 8px',
              background: 'transparent',
              border: '1px dashed var(--blue)',
              color: 'var(--blue)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            + insert
          </button>
        )}
      </div>
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={pickerItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}

function SetTrackRow({
  index,
  trackId,
  track,
  onRemove,
}: {
  index: number;
  trackId: number;
  track: Track | undefined;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      data-set-track-row
      draggable
      onDragStart={(e) => setTrackDragPayload(e.dataTransfer, [trackId], 'set-pane')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 12px',
        borderBottom: '1px solid var(--surface0)',
        background: hovered ? 'var(--surface0)' : 'transparent',
        cursor: 'grab',
      }}
    >
      <span style={{ width: '24px', textAlign: 'right', color: 'var(--subtext0)', fontSize: '12px' }}>
        {index + 1}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--text)' }}>{track?.title ?? `Track ${trackId}`}</span>
        {track?.artist && (
          <span style={{ color: 'var(--subtext0)', marginLeft: '8px' }}>{track.artist}</span>
        )}
      </span>
      <span style={{ width: '40px', color: 'var(--sapphire)', fontSize: '12px' }}>
        {formatKeyDisplay(track?.key ?? null)}
      </span>
      <span style={{ width: '64px', color: 'var(--subtext1)', fontSize: '12px', textAlign: 'right' }}>
        {track?.bpm ? `${track.bpm.toFixed(1)} BPM` : '—'}
      </span>
      <button
        onClick={onRemove}
        title="Remove from set"
        style={{
          visibility: hovered ? 'visible' : 'hidden',
          padding: '2px 8px',
          background: 'transparent',
          border: 'none',
          color: 'var(--red)',
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
}
