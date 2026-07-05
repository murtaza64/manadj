/**
 * The Set detail pane (sets 01): replaces the track table on the browse
 * surface when a Set is selected. Ordered track rows (title/artist, key,
 * BPM) with drag-reorder and remove; adds arrive by dropping tracks onto
 * the Set's sidebar row or the pane itself. Scroll position and selection
 * live in the set store — the pane survives mode switches unmoved.
 */
import { useEffect, useRef, useState } from 'react';
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
import {
  addTracksToSet,
  ensureSetEntriesLoaded,
  getSetScroll,
  removeTrackFromSet,
  reorderSetEntries,
  setSetScroll,
  useSetEntries,
} from './setStore';

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
            return (
              <SetTrackRow
                key={entry.trackId}
                index={i}
                trackId={entry.trackId}
                track={track}
                onRemove={() => removeTrackFromSet(setId, entry.trackId)}
              />
            );
          })
        )}
      </div>
    </div>
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
