/**
 * Visualizer preset browser for the clip editor (#377 r3): every preset —
 * the curated set and the whole genepool (alive and dead) — searchable by
 * name / id / brief and sortable by score (arena thumbs), approvals,
 * rating, generation (newest first) or name.
 */
import { useMemo, useState } from 'react';
import { presetCatalogue, type PresetListing } from './offlineVisualizer';
import { tallyFor, usePresetRatings } from '../visualizer/presetRatings';

type SortKey = 'score' | 'approvals' | 'rating' | 'newest' | 'name';

interface Props {
  /** Ids shown as selected (single pick: one id; rotation: many). */
  selected: readonly string[];
  onPick: (id: string) => void;
  /** Rotation mode shows the 1-based position of selected ids. */
  ordered?: boolean;
  height?: number;
}

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'score', label: 'score' },
  { id: 'approvals', label: 'likes' },
  { id: 'rating', label: 'rating' },
  { id: 'newest', label: 'newest' },
  { id: 'name', label: 'name' },
];

function sortListings(rows: PresetListing[], key: SortKey): PresetListing[] {
  const out = [...rows];
  const by: Record<SortKey, (a: PresetListing, b: PresetListing) => number> = {
    score: (a, b) => b.score - a.score || b.rating - a.rating,
    approvals: (a, b) => b.approvals - a.approvals || b.score - a.score,
    rating: (a, b) => b.rating - a.rating,
    newest: (a, b) => (b.generation ?? -1) - (a.generation ?? -1) || b.score - a.score,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return out.sort((a, b) => by[key](a, b) || a.id.localeCompare(b.id));
}

export function PresetBrowser({ selected, onPick, ordered, height = 220 }: Props) {
  const catalogue = useMemo(() => presetCatalogue(), []);
  const { tallies } = usePresetRatings();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('score');
  const [showDead, setShowDead] = useState(false);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = catalogue.filter((p) =>
      (showDead || p.status !== 'dead')
      && (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.brief.toLowerCase().includes(q)));
    return sortListings(filtered, sort);
  }, [catalogue, query, sort, showDead]);

  return (
    <div className="ce-browser">
      <div className="ce-browser-bar">
        <input type="text" placeholder={`search ${catalogue.length} presets…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="ce-seg">
          {SORTS.map((s) => (
            <button key={s.id} className={`btn btn-mini${sort === s.id ? ' btn-selected' : ''}`} onClick={() => setSort(s.id)}>{s.label}</button>
          ))}
        </span>
        <label className="ce-check"><input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} />dead</label>
      </div>
      <div className="ce-browser-list" style={{ maxHeight: height }}>
        {rows.map((p) => {
          const idx = selected.indexOf(p.id);
          const live = tallyFor(tallies, p.id);
          return (
            <button
              key={p.id}
              className={`ce-browser-row${idx >= 0 ? ' ce-browser-row-on' : ''}${p.status === 'dead' ? ' ce-browser-row-dead' : ''}`}
              onClick={() => onPick(p.id)}
              title={p.brief || p.id}
            >
              <span className="ce-browser-pos">{idx >= 0 ? (ordered ? idx + 1 : '●') : ''}</span>
              <span className="ce-browser-name">{p.name}</span>
              <span className="ce-browser-meta">{p.source === 'curated' ? 'curated' : `g${String(p.generation ?? 0).padStart(2, '0')}`}</span>
              <span className="ce-browser-meta">{p.score > 0 ? `+${p.score}` : p.score}</span>
              <span className="ce-browser-meta">♥ {p.approvals}</span>
              <span className="ce-browser-meta" title="Ratings from every surface (viz, clip editor, reviewer, phone): likes / nopes">{live ? `${live.likes}/${live.dislikes}` : ''}</span>
              <span className="ce-browser-brief">{p.brief}</span>
            </button>
          );
        })}
        {rows.length === 0 && <div className="ce-muted">no match</div>}
      </div>
    </div>
  );
}
