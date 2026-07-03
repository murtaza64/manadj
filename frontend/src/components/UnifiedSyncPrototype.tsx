/**
 * PROTOTYPE — THROWAWAY. Do not build on this.
 *
 * Iteration 2 of the unified Sync "Tracks" view prototype.
 * Verdict from iteration 1: Inbox layout won; C's expandable detail absorbed
 * into it as a divergence matrix; C dropped; B kept for comparison.
 *
 * ?variant=A|B, floating bar, or arrow keys.
 *
 * A — Inbox (refined): status groups + expandable divergence matrix per row.
 *     Matrix shows ONLY diverged fields; agreeing surfaces render as ✓;
 *     conflicting surfaces show their value; tag diffs are color-coded chips.
 * B — Master/detail (unchanged shape, new data model).
 */

import { useEffect, useState } from 'react';
import './UnifiedSyncPrototype.css';

// ---------------------------------------------------------------- data model

type SurfaceId = 'disk' | 'library' | 'engine' | 'rekordbox';
type ExternalSurface = Exclude<SurfaceId, 'library'>;
const EXTERNAL_SURFACES: { id: ExternalSurface; label: string; short: string }[] = [
  { id: 'disk', label: 'Disk', short: 'D' },
  { id: 'engine', label: 'Engine DJ', short: 'E' },
  { id: 'rekordbox', label: 'Rekordbox', short: 'R' },
];
const ALL_SURFACES: { id: SurfaceId; label: string; short: string }[] = [
  { id: 'disk', label: 'Disk', short: 'D' },
  { id: 'library', label: 'Library', short: 'L' },
  { id: 'engine', label: 'Engine DJ', short: 'E' },
  { id: 'rekordbox', label: 'Rekordbox', short: 'R' },
];

type Presence = 'present' | 'missing';
type ScalarField = 'title' | 'artist' | 'key' | 'bpm' | 'energy';

/** Per-field values: library = truth; per external surface either a string
 * value, null (surface carries the field but has no value), or undefined
 * (surface can't carry this field / track absent there). */
type FieldValues = { library: string | null } & Partial<Record<ExternalSurface, string | null>>;

interface TagValues {
  library: string[];
  engine?: string[]; // encoded as ManaDJ Tags playlists
  rekordbox?: string[]; // encoded as MyTags
  // disk: not carried today (future: ID3 genre export)
}

interface Row {
  id: number;
  title: string;
  artist: string;
  presence: Record<SurfaceId, Presence>;
  fields: Partial<Record<ScalarField, FieldValues>>;
  tags?: TagValues;
  unprocessed?: boolean;
  status: 'missing-downstream' | 'not-in-library' | 'unimported' | 'diverged' | 'in-sync';
}

const p = (
  disk: Presence, library: Presence, engine: Presence, rekordbox: Presence,
): Record<SurfaceId, Presence> => ({ disk, library, engine, rekordbox });

const ROWS: Row[] = [
  // --- missing downstream ---
  { id: 1, title: 'Brazil', artist: 'A.M.C', presence: p('present', 'present', 'missing', 'present'), fields: {}, status: 'missing-downstream' },
  { id: 2, title: 'Mind The Gap (BRAN.CHI EDIT)', artist: 'A.M.C, BRAN.CHI', presence: p('present', 'present', 'missing', 'missing'), fields: {}, unprocessed: true, status: 'missing-downstream' },
  { id: 3, title: 'Silhouettes (Aktive DNB Bootleg)', artist: 'Avicii, Aktive', presence: p('present', 'present', 'missing', 'present'), fields: {}, status: 'missing-downstream' },
  // --- not in library ---
  { id: 4, title: 'Sound Of The Underground', artist: 'Zeds Dead x Urbandawn', presence: p('present', 'missing', 'present', 'missing'), fields: {}, status: 'not-in-library' },
  { id: 5, title: 'fuji opener (vr dnb remix)', artist: 'Skrillex, Virtual Riot', presence: p('missing', 'missing', 'present', 'present'), fields: {}, status: 'not-in-library' },
  { id: 6, title: 'Glue (Kanine Remix)', artist: 'Bicep, Kanine', presence: p('present', 'missing', 'missing', 'present'), fields: {}, status: 'not-in-library' },
  // --- unimported disk files ---
  { id: 7, title: 'mandidextrous-full-tilt-master.flac', artist: '—', presence: p('present', 'missing', 'missing', 'missing'), fields: {}, status: 'unimported' },
  { id: 8, title: 'ISOxo - what2do (VIP).mp3', artist: '—', presence: p('present', 'missing', 'missing', 'missing'), fields: {}, status: 'unimported' },
  // --- diverged ---
  {
    // the user's exact example: title agrees on disk+rekordbox, conflicts on engine
    id: 11, title: 'Mans Not Hot (Full DNB Mix)', artist: 'Big Shaq, Kritix',
    presence: p('present', 'present', 'present', 'present'),
    fields: {
      title: {
        library: 'Mans Not Hot (Full DNB Mix)',
        disk: 'Mans Not Hot (Full DNB Mix)',
        engine: 'mans not hot dnb FINAL v2',
        rekordbox: 'Mans Not Hot (Full DNB Mix)',
      },
    },
    tags: {
      library: ['DnB', 'Jump Up', 'Peak Time'],
      engine: ['DnB', 'Jump Up', 'Peak Time'],
      rekordbox: ['DnB', 'Wave'], // missing Jump Up + Peak Time, has extra Wave
    },
    status: 'diverged',
  },
  {
    id: 12, title: 'Und die Engel singen (Virtual Riot Remix)', artist: 'Virtual Riot',
    presence: p('present', 'present', 'present', 'present'),
    fields: {
      key: { library: null, disk: null, engine: 'G#m (1A)', rekordbox: null },
      bpm: { library: null, disk: '174', engine: '174.00', rekordbox: null },
    },
    status: 'diverged',
  },
  {
    id: 13, title: 'i like the way you kiss me (d&b flip)', artist: 'Artemas, Culture Shock',
    presence: p('present', 'present', 'present', 'present'),
    fields: {
      energy: { library: '4', rekordbox: null }, // rekordbox has no color set
    },
    status: 'diverged',
  },
  // --- in sync stand-ins ---
  { id: 14, title: 'Golden Hour (Trace Remix)', artist: 'Nu Aspect', presence: p('present', 'present', 'present', 'present'), fields: {}, status: 'in-sync' },
  { id: 15, title: 'Turmoiled', artist: 'leroy', presence: p('present', 'present', 'present', 'present'), fields: {}, status: 'in-sync' },
];

const IN_SYNC_TOTAL = 911;

const STATUS_META: Record<Row['status'], { label: string; chip: string }> = {
  'missing-downstream': { label: 'Missing downstream', chip: 'missing' },
  'not-in-library': { label: 'Not in Library', chip: 'import' },
  unimported: { label: 'Unimported files', chip: 'unimported' },
  diverged: { label: 'Diverged fields', chip: 'diverged' },
  'in-sync': { label: 'In sync', chip: 'insync' },
};

// which surfaces disagree with the library for a field
function divergedSurfaces(fv: FieldValues): ExternalSurface[] {
  return EXTERNAL_SURFACES.filter((s) => {
    const v = fv[s.id];
    return v !== undefined && v !== fv.library;
  }).map((s) => s.id);
}

function tagsDiverged(t: TagValues, s: ExternalSurface): boolean {
  const surfaceTags = t[s as 'engine' | 'rekordbox'];
  if (surfaceTags === undefined) return false;
  const a = [...t.library].sort().join('|');
  const b = [...surfaceTags].sort().join('|');
  return a !== b;
}

function divergedFieldNames(row: Row): string[] {
  const names = Object.entries(row.fields)
    .filter(([, fv]) => divergedSurfaces(fv!).length > 0)
    .map(([f]) => f);
  if (row.tags && EXTERNAL_SURFACES.some((s) => tagsDiverged(row.tags!, s.id))) names.push('tags');
  return names;
}

const defaultAction = (row: Row): string => {
  switch (row.status) {
    case 'missing-downstream': {
      const targets = ALL_SURFACES
        .filter((s) => s.id !== 'disk' && s.id !== 'library' && row.presence[s.id] === 'missing')
        .map((s) => s.label);
      return `Export to ${targets.join(' + ')}`;
    }
    case 'not-in-library':
    case 'unimported':
      return 'Import to Library';
    case 'diverged':
      return 'Export fields';
    default:
      return '';
  }
};

// ------------------------------------------------------------------- shared

function useVariant(): [string, (v: string) => void] {
  const read = () => new URLSearchParams(window.location.search).get('variant') ?? 'A';
  const [variant, setVariant] = useState(read);
  const set = (v: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', v);
    window.history.replaceState(null, '', url.toString());
    setVariant(v);
  };
  return [variant, set];
}

const PIP_LABELS: Record<SurfaceId, string> = {
  disk: 'disk',
  library: 'library',
  engine: 'engine',
  rekordbox: 'rekordbox',
};

function PresencePips({ row }: { row: Row }) {
  return (
    <span className="proto-pips">
      {ALL_SURFACES.map((s) => (
        <span key={s.id} title={`${s.label}: ${row.presence[s.id]}`} className={`proto-pip proto-pip-${row.presence[s.id]}`}>
          {PIP_LABELS[s.id]}
        </span>
      ))}
    </span>
  );
}

/** Tag diff cell: union of library+surface tags as chips.
 * green = in both · red dashed = in Library, missing here · orange = extra here */
function TagDiffCell({ tags, surface }: { tags: TagValues; surface: ExternalSurface }) {
  const surfaceTags = tags[surface as 'engine' | 'rekordbox'];
  if (surfaceTags === undefined) return <span className="proto-cell-na">·</span>;
  if (!tagsDiverged(tags, surface)) return <span className="proto-cell-ok">✓</span>;
  const union = [...new Set([...tags.library, ...surfaceTags])];
  return (
    <span className="proto-tagdiff">
      {union.map((tag) => {
        const inLib = tags.library.includes(tag);
        const here = surfaceTags.includes(tag);
        const cls = inLib && here ? 'both' : inLib ? 'missing-here' : 'extra-here';
        return <span key={tag} className={`proto-tagchip proto-tagchip-${cls}`}>{tag}</span>;
      })}
    </span>
  );
}

/** The divergence matrix: one row per DIVERGED field only.
 * Library column shows the truth; agreeing surfaces show ✓; conflicting
 * surfaces show their value, highlighted. */
function DivergenceMatrix({ row }: { row: Row }) {
  const scalarRows = (Object.entries(row.fields) as [ScalarField, FieldValues][])
    .filter(([, fv]) => divergedSurfaces(fv).length > 0);
  const showTags = row.tags && EXTERNAL_SURFACES.some((s) => tagsDiverged(row.tags!, s.id));

  return (
    <table className="proto-divmatrix">
      <thead>
        <tr>
          <th />
          <th className="proto-divmatrix-lib">Library</th>
          {EXTERNAL_SURFACES.map((s) => <th key={s.id}>{s.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {scalarRows.map(([field, fv]) => (
          <tr key={field}>
            <td className="proto-grid-fieldname">{field}</td>
            <td className="proto-divmatrix-lib">{fv.library ?? <span className="proto-novalue">no value</span>}</td>
            {EXTERNAL_SURFACES.map((s) => {
              const v = fv[s.id];
              if (row.presence[s.id] === 'missing' || v === undefined) {
                return <td key={s.id} className="proto-cell-na">·</td>;
              }
              if (v === fv.library) return <td key={s.id} className="proto-cell-ok">✓</td>;
              return (
                <td key={s.id} className="proto-cell-diverged">
                  {v ?? <span className="proto-novalue">no value</span>}
                  <button className="proto-microbtn" title={`Import from ${s.label}`}>← import</button>
                </td>
              );
            })}
          </tr>
        ))}
        {showTags && (
          <tr>
            <td className="proto-grid-fieldname">tags</td>
            <td className="proto-divmatrix-lib">
              {row.tags!.library.map((t) => <span key={t} className="proto-tagchip proto-tagchip-both">{t}</span>)}
            </td>
            {EXTERNAL_SURFACES.map((s) => (
              <td key={s.id}>
                {s.id === 'disk'
                  ? <span className="proto-cell-na">·</span>
                  : <TagDiffCell tags={row.tags!} surface={s.id} />}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Chip({ kind, label, count, active, onClick }: {
  kind: string; label: string; count: number; active?: boolean; onClick?: () => void;
}) {
  return (
    <button className={`proto-chip proto-chip-${kind} ${active ? 'proto-chip-active' : ''}`} onClick={onClick}>
      <b>{count}</b> {label}
    </button>
  );
}

const ATTENTION = ROWS.filter((r) => r.status !== 'in-sync');

// ---------------------------------------------------------------- variant A

const BULK_VERB: Partial<Record<Row['status'], string>> = {
  'missing-downstream': 'Export',
  'not-in-library': 'Import',
  unimported: 'Import',
  diverged: 'Export fields for',
};

function VariantA() {
  const [filter, setFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set([11])); // demo: open the diff example
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleSelect = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    setSelected(next);
  };
  const toggleSelectAll = (rows: Row[]) => {
    const ids = rows.map((r) => r.id);
    const allSelected = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
    setSelected(next);
  };
  const c = {
    missing: ROWS.filter((r) => r.status === 'missing-downstream').length,
    import: ROWS.filter((r) => r.status === 'not-in-library').length,
    unimported: ROWS.filter((r) => r.status === 'unimported').length,
    diverged: ROWS.filter((r) => r.status === 'diverged').length,
  };
  const toggleExpand = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    setExpanded(next);
  };

  const groups = (['missing-downstream', 'diverged', 'not-in-library', 'unimported'] as Row['status'][])
    .map((status) => ({ status, rows: ATTENTION.filter((r) => r.status === status) }))
    .filter((g) => g.rows.length > 0 && (!filter || STATUS_META[g.status].chip === filter));

  return (
    <div className="proto-inbox">
      <div className="proto-chipbar">
        <Chip kind="missing" label="missing downstream" count={c.missing} active={filter === 'missing'} onClick={() => setFilter(filter === 'missing' ? null : 'missing')} />
        <Chip kind="diverged" label="diverged" count={c.diverged} active={filter === 'diverged'} onClick={() => setFilter(filter === 'diverged' ? null : 'diverged')} />
        <Chip kind="import" label="not in Library" count={c.import} active={filter === 'import'} onClick={() => setFilter(filter === 'import' ? null : 'import')} />
        <Chip kind="unimported" label="unimported files" count={c.unimported} active={filter === 'unimported'} onClick={() => setFilter(filter === 'unimported' ? null : 'unimported')} />
        <span className="proto-chip proto-chip-insync"><b>{IN_SYNC_TOTAL}</b> in sync</span>
      </div>

      {groups.map((g) => {
        const selectedInGroup = g.rows.filter((r) => selected.has(r.id)).length;
        return (
        <section key={g.status} className="proto-inbox-group">
          <h3>
            <input
              type="checkbox"
              checked={g.rows.every((r) => selected.has(r.id))}
              onChange={() => toggleSelectAll(g.rows)}
              title="Select all in section"
            />
            {STATUS_META[g.status].label} <span>{g.rows.length}</span>
            {selectedInGroup > 0 && (
              <button className="proto-btn proto-btn-primary proto-bulk-btn">
                {BULK_VERB[g.status]} {selectedInGroup} selected (dry-run)
              </button>
            )}
          </h3>
          {g.rows.map((row) => {
            const fieldNames = divergedFieldNames(row);
            const expandable = fieldNames.length > 0;
            const isOpen = expanded.has(row.id);
            return (
              <div key={row.id} className={`proto-inbox-card ${row.unprocessed ? 'proto-warn' : ''}`}>
                <div
                  className={`proto-inbox-row ${expandable ? 'proto-row-expandable' : ''}`}
                  onClick={expandable ? () => toggleExpand(row.id) : undefined}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelect(row.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {expandable && <span className={`proto-chevron ${isOpen ? 'proto-chevron-open' : ''}`}>▸</span>}
                  <PresencePips row={row} />
                  <div className="proto-inbox-track">
                    <div className="proto-track-title">{row.title}</div>
                    <div className="proto-track-sub">
                      {row.artist}
                      {fieldNames.length > 0 && (
                        <span className="proto-field-tags">
                          {fieldNames.map((f) => <code key={f}>{f}</code>)}
                        </span>
                      )}
                      {row.unprocessed && <span className="proto-unprocessed-badge">unprocessed — exports with no tags</span>}
                    </div>
                  </div>
                  <button className="proto-btn proto-btn-primary" onClick={(e) => e.stopPropagation()}>
                    {defaultAction(row)}
                  </button>
                </div>
                {isOpen && expandable && (
                  <div className="proto-inbox-expand">
                    <DivergenceMatrix row={row} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
        );
      })}

      <button className="proto-showall" onClick={() => setShowAll(!showAll)}>
        {showAll ? 'Hide' : 'Show'} {IN_SYNC_TOTAL} in-sync tracks
      </button>
      {showAll && ROWS.filter((r) => r.status === 'in-sync').map((row) => (
        <div key={row.id} className="proto-inbox-card">
          <div className="proto-inbox-row proto-row-insync">
            <PresencePips row={row} />
            <div className="proto-inbox-track">
              <div className="proto-track-title">{row.title}</div>
              <div className="proto-track-sub">{row.artist}</div>
            </div>
            <span className="proto-insync-check">✓ in sync</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- variant B

function VariantB() {
  const [selectedId, setSelectedId] = useState<number>(11);
  const row = ROWS.find((r) => r.id === selectedId)!;

  return (
    <div className="proto-master-detail">
      <aside className="proto-md-list">
        <div className="proto-md-summary">
          {ATTENTION.length} tracks need attention · {IN_SYNC_TOTAL} in sync
        </div>
        {(['missing-downstream', 'diverged', 'not-in-library', 'unimported'] as Row['status'][]).map((status) => (
          <div key={status}>
            <div className="proto-md-grouphead">{STATUS_META[status].label}</div>
            {ATTENTION.filter((r) => r.status === status).map((r) => (
              <button
                key={r.id}
                className={`proto-md-item ${r.id === selectedId ? 'proto-md-item-active' : ''}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span className={`proto-dot proto-dot-${STATUS_META[r.status].chip}`} />
                <span className="proto-md-item-title">{r.title}</span>
                <PresencePips row={r} />
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main className="proto-md-detail">
        <h2>{row.title}</h2>
        <p className="proto-md-artist">{row.artist} {row.unprocessed && <span className="proto-unprocessed-badge">unprocessed</span>}</p>
        {divergedFieldNames(row).length > 0
          ? <DivergenceMatrix row={row} />
          : <p className="proto-novalue">No field divergences — {STATUS_META[row.status].label.toLowerCase()}.</p>}
        <div className="proto-md-actions">
          <button className="proto-btn proto-btn-primary">{defaultAction(row) || 'Nothing to do'}</button>
          <label className="proto-dryrun"><input type="checkbox" defaultChecked /> dry-run first</label>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- switcher

const VARIANTS: Record<string, { name: string; component: () => React.JSX.Element }> = {
  A: { name: 'Inbox + divergence matrix', component: VariantA },
  B: { name: 'Master / detail', component: VariantB },
};

export function UnifiedSyncPrototype() {
  const [variant, setVariant] = useVariant();
  const keys = Object.keys(VARIANTS);
  const idx = Math.max(0, keys.indexOf(variant));
  const cycle = (delta: number) => setVariant(keys[(idx + delta + keys.length) % keys.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const Active = VARIANTS[keys[idx]].component;
  return (
    <div className="proto-root">
      <Active />
      <div className="proto-switcher">
        <button onClick={() => cycle(-1)}>←</button>
        <span>{keys[idx]} — {VARIANTS[keys[idx]].name}</span>
        <button onClick={() => cycle(1)}>→</button>
      </div>
    </div>
  );
}
