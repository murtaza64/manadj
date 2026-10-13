import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ColumnConfig } from './columnConfig';
import { COLUMN_DRAG_MIME, reorderColumns, setColumnOrder } from './columnOrder';
import { ColumnResizeHandle } from './ColumnResizeHandle';
import { scrollableAncestor } from './virtualRows';
import { MusicIcon, PersonIcon, KeyIcon, SpeedIcon, EnergyIcon, TagIcon, CalendarIcon, CrosshairIcon, WaveformIcon } from './icons';

export type SortColumn = 'position' | 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance';

const HEADERS: Record<string, { label: string; icon?: ReactNode; text?: string; sort?: SortColumn; center?: boolean }> = {
  order: { label: 'Play order', text: '#', sort: 'position' },
  key: { label: 'Key', icon: <KeyIcon />, sort: 'key', center: true },
  bpm: { label: 'BPM', icon: <SpeedIcon />, sort: 'bpm', center: true },
  energy: { label: 'Energy', icon: <EnergyIcon />, sort: 'energy', center: true },
  marks: { label: 'Evidence / match score', icon: <CrosshairIcon width={13} height={13} />, center: true },
  title: { label: 'Title', icon: <MusicIcon />, sort: 'title' },
  artist: { label: 'Artist', icon: <PersonIcon />, sort: 'artist' },
  waveform: { label: 'Waveform / hotcues', icon: <WaveformIcon /> },
  created_at: { label: 'Date added', icon: <CalendarIcon />, sort: 'created_at' },
  tags: { label: 'Tags', icon: <TagIcon /> },
  stems: { label: 'Stems ready', text: 'st' },
  quality: { label: 'Quality', text: 'quality', sort: 'bitrate_kbps' },
  size: { label: 'File size', text: 'size', sort: 'filesize_bytes' },
  provenance: { label: 'Source', text: 'from', sort: 'provenance' },
};

interface Props {
  columns: readonly ColumnConfig[];
  order: readonly string[];
  widths: Record<string, number>;
  setWidth: (id: string, width: number) => void;
  resetWidth: (id: string) => void;
  sortColumn: SortColumn | null;
  sortDirection: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  hasScore: boolean;
  scoreSorted: boolean;
  onScoreSort?: () => void;
}

export function TrackColumnHeaders({ columns, order, widths, setWidth, resetWidth, sortColumn, sortDirection, onSort, hasScore, scoreSorted, onScoreSort }: Props) {
  const source = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  useEffect(() => () => {
    if (source.current) document.body.classList.remove('column-dragging');
  }, []);
  return (
    <tr>
      {columns.map(column => {
        const header = HEADERS[column.id];
        const sort = header.sort;
        const isScore = column.id === 'marks' && hasScore;
        const sorted = isScore ? scoreSorted : sort !== undefined && sortColumn === sort;
        return (
          <th
            key={column.id}
            data-column-id={column.id}
            aria-label={header.label}
            aria-sort={sort || isScore ? sorted ? (isScore || sortDirection === 'desc' ? 'descending' : 'ascending') : 'none' : undefined}
            className={[
              'track-column-header sortable-header',
              column.sticky ? 'sticky-col-header' : '',
              column.showShadow ? 'sticky-shadow' : '',
              sorted ? 'sorted' : '',
              column.id === 'waveform' ? 'track-waveform-header' : '',
              column.id === 'tags' ? 'tags-header' : '',
              drop?.id === column.id ? `column-drop-${drop.after ? 'after' : 'before'}` : '',
            ].filter(Boolean).join(' ')}
            style={{
              width: `var(--colw-${column.id})`,
              minWidth: `var(--colw-${column.id})`,
              maxWidth: `var(--colw-${column.id})`,
              textAlign: column.align ?? 'left',
              ...(column.sticky ? { left: `var(--colleft-${column.id})` } : {}),
            }}
            title={`${header.label}${column.sticky ? ' (frozen)' : ''}. Drag to move${sort || isScore ? '; click to sort' : ''}.`}
            draggable
            onMouseDownCapture={() => { suppressClick.current = false; }}
            onClick={() => {
              if (suppressClick.current) return;
              if (isScore) onScoreSort?.();
              else if (sort) onSort(sort);
            }}
            onDragStart={event => {
              if (document.body.classList.contains('col-resizing')) {
                event.preventDefault();
                return;
              }
              event.stopPropagation();
              source.current = column.id;
              document.body.classList.add('column-dragging');
              suppressClick.current = true;
              event.dataTransfer.setData(COLUMN_DRAG_MIME, column.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={event => {
              if (!source.current || !event.dataTransfer.types.includes(COLUMN_DRAG_MIME)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              const bounds = event.currentTarget.getBoundingClientRect();
              const after = event.clientX >= bounds.left + bounds.width / 2;
              setDrop(previous => previous?.id === column.id && previous.after === after ? previous : { id: column.id, after });
              const scroller = scrollableAncestor(event.currentTarget);
              if (scroller) {
                const viewport = scroller.getBoundingClientRect();
                if (event.clientX > viewport.right - 32) scroller.scrollLeft += 24;
                else if (event.clientX < viewport.left + 32) scroller.scrollLeft -= 24;
              }
            }}
            onDragLeave={event => {
              if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(null);
            }}
            onDrop={event => {
              if (!source.current || event.dataTransfer.getData(COLUMN_DRAG_MIME) !== source.current) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              setColumnOrder(reorderColumns(order, source.current, column.id, event.clientX >= bounds.left + bounds.width / 2));
              document.body.classList.remove('column-dragging');
              source.current = null;
              setDrop(null);
            }}
            onDragEnd={() => {
              document.body.classList.remove('column-dragging');
              source.current = null;
              setDrop(null);
            }}
          >
            <div className={`sortable-header-content ${header.center ? 'align-center' : column.align === 'right' ? 'align-right' : ''}`}>
              {header.icon ?? header.text}
              {sorted && <span className="sort-indicator">{isScore || sortDirection === 'desc' ? '▼' : '▲'}</span>}
            </div>
            <ColumnResizeHandle columnId={column.id} currentWidth={widths[column.id]} onResize={setWidth} onReset={resetWidth} />
          </th>
        );
      })}
    </tr>
  );
}
