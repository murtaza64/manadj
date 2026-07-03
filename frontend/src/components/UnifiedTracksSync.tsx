/**
 * Unified Tracks sync view (see .scratch/unified-sync-view/PRD.md).
 *
 * One row per track matched across Surfaces (disk / library / engine /
 * rekordbox), inbox-style: attention rows grouped by status, expandable
 * divergence matrix, per-section bulk actions. Replaces the old Tracks,
 * Metadata, and Tag Sync tabs.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, BACKEND_URL } from '../api/client';
import { formatKeyDisplay } from '../utils/keyUtils';
import './UnifiedTracksSync.css';

// ------------------------------------------------------------------- types

type SurfaceId = 'disk' | 'engine' | 'rekordbox';
type PresenceId = SurfaceId | 'library';
type RowStatus = 'missing-downstream' | 'diverged' | 'not-in-library' | 'unimported' | 'in-sync';

interface FieldDivergence {
  field: string;
  library_value: unknown;
  surface_values: Record<string, unknown>;
  importable_from: string[];
  no_overwrite: boolean;
}

interface StatusRow {
  path: string;
  title: string | null;
  artist: string | null;
  track_id: number | null;
  presence: Record<PresenceId, boolean>;
  status: RowStatus;
  unprocessed: boolean;
  diverged: FieldDivergence[];
  warnings: string[];
}

interface StatusResponse {
  surfaces_available: SurfaceId[];
  counts: Record<RowStatus, number>;
  rows: StatusRow[];
}

const EXTERNAL_SURFACES: { id: SurfaceId; label: string }[] = [
  { id: 'disk', label: 'Disk' },
  { id: 'engine', label: 'Engine DJ' },
  { id: 'rekordbox', label: 'Rekordbox' },
];
const PRESENCE_ORDER: PresenceId[] = ['disk', 'library', 'engine', 'rekordbox'];

const GROUPS: { status: RowStatus; label: string; chip: string }[] = [
  { status: 'missing-downstream', label: 'Missing downstream', chip: 'missing' },
  { status: 'diverged', label: 'Diverged fields', chip: 'diverged' },
  { status: 'not-in-library', label: 'Not in Library', chip: 'import' },
  { status: 'unimported', label: 'Unimported files', chip: 'unimported' },
];

// ------------------------------------------------------------------- utils

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  if (field === 'key') return formatKeyDisplay(v as number);
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BACKEND_URL}/api/sync/status/`);
  if (!res.ok) throw new Error(`sync status failed: ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------- view

export function UnifiedTracksSync() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['sync-status'], queryFn: fetchStatus });

  const [filter, setFilter] = useState<string | null>(null);
  const [showInSync, setShowInSync] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  const done = (msg: string) => {
    setNotice(msg);
    setSelected(new Set());
    refresh();
  };

  const exportEngine = useMutation({
    mutationFn: () => api.syncTracks.syncEngineRBXML({ validate_files: true }),
    onSuccess: (r) => done(`RBXML written: ${JSON.stringify(r.stats ?? r)}`),
  });
  const exportRekordbox = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.syncTracks.syncRekordbox({ dry_run: dryRun, skip_import: true }),
    onSuccess: (r, dryRun) =>
      dryRun ? setNotice(`Dry-run: ${JSON.stringify(r.stats ?? r)}`) : done('Exported to Rekordbox'),
  });
  const importRekordbox = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.syncTracks.syncRekordbox({ dry_run: dryRun, skip_export: true }),
    onSuccess: (r, dryRun) =>
      dryRun ? setNotice(`Dry-run: ${JSON.stringify(r.stats ?? r)}`) : done('Imported from Rekordbox'),
  });
  const importFiles = useMutation({
    mutationFn: (filepaths: string[]) => api.libraryImport.import({ candidate_filepaths: filepaths }),
    onSuccess: (r) => done(`Imported ${r.imported} files`),
  });
  const importField = useMutation({
    mutationFn: ({ row, field, value }: { row: StatusRow; field: string; value: unknown }) => {
      if (field === 'energy') {
        return api.tracks.update(row.track_id!, { energy: value as number });
      }
      const v = field === 'key' ? fmtValue('key', value) : value;
      return api.tracks.syncMetadata({
        updates: [{ track_id: row.track_id!, fields: { [field]: v as string | number | null } }],
        dry_run: false,
      });
    },
    onSuccess: () => done('Field imported'),
  });
  const exportRowToDisk = useMutation({
    mutationFn: (row: StatusRow) => {
      const fields: Record<string, string | number | null> = {};
      for (const d of row.diverged) {
        if (d.no_overwrite || !('disk' in d.surface_values)) continue;
        if (['title', 'artist', 'bpm', 'key'].includes(d.field)) {
          fields[d.field] = fmtValue(d.field, d.library_value) || null;
        }
      }
      return api.tracks.writeToFiles({
        updates: [{ track_id: row.track_id!, fields }],
        dry_run: false,
      });
    },
    onSuccess: () => done('Written to file'),
  });
  const exportTags = useMutation({
    mutationFn: (target: 'engine' | 'rekordbox') =>
      target === 'engine'
        ? api.tags.syncToEngine({ target, dry_run: false })
        : api.tags.syncToRekordbox({ target, dry_run: false }),
    onSuccess: () => done('Tags exported'),
  });
  const rebuildTagTree = useMutation({
    mutationFn: () => api.tags.syncToEngine({ target: 'engine', dry_run: false, fresh: true }),
    onSuccess: () => done('Engine tag tree rebuilt'),
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const attention = useMemo(() => rows.filter((r) => r.status !== 'in-sync'), [rows]);
  const inSync = useMemo(() => rows.filter((r) => r.status === 'in-sync'), [rows]);

  if (isLoading) return <div className="uts-empty">Computing sync status…</div>;
  if (error) return <div className="uts-empty uts-error">Failed to load sync status: {String(error)}</div>;
  if (!data) return null;

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) { next.delete(key); } else { next.add(key); }
    return next;
  };

  const groupRows = (status: RowStatus) =>
    attention.filter((r) => r.status === status);

  return (
    <div className="uts-root">
      <div className="uts-chipbar">
        {GROUPS.map((g) => (
          <button
            key={g.status}
            className={`uts-chip uts-chip-${g.chip} ${filter === g.status ? 'uts-chip-active' : ''}`}
            onClick={() => setFilter(filter === g.status ? null : g.status)}
          >
            <b>{data.counts[g.status]}</b> {g.label.toLowerCase()}
          </button>
        ))}
        <span className="uts-chip uts-chip-insync"><b>{data.counts['in-sync']}</b> in sync</span>
        <span className="uts-surfaces-note">
          surfaces: {data.surfaces_available.join(', ') || 'none reachable'}
        </span>
      </div>

      {notice && (
        <div className="uts-notice" onClick={() => setNotice(null)}>{notice} ✕</div>
      )}

      {GROUPS.filter((g) => (!filter || filter === g.status) && groupRows(g.status).length > 0).map((g) => {
        const list = groupRows(g.status);
        const selectedHere = list.filter((r) => selected.has(r.path));
        return (
          <section key={g.status} className="uts-group">
            <h3>
              <input
                type="checkbox"
                checked={list.every((r) => selected.has(r.path))}
                onChange={() => {
                  const all = list.every((r) => selected.has(r.path));
                  const next = new Set(selected);
                  list.forEach((r) => (all ? next.delete(r.path) : next.add(r.path)));
                  setSelected(next);
                }}
              />
              {g.label} <span className="uts-count">{list.length}</span>
              <GroupActions
                status={g.status}
                selected={selectedHere}
                onExportEngine={() => exportEngine.mutate()}
                onExportRekordbox={(dry) => exportRekordbox.mutate(dry)}
                onImportRekordbox={(dry) => importRekordbox.mutate(dry)}
                onImportFiles={(paths) => importFiles.mutate(paths)}
              />
            </h3>
            {list.map((row) => (
              <RowCard
                key={row.path}
                row={row}
                selected={selected.has(row.path)}
                onSelect={() => setSelected(toggle(selected, row.path))}
                expanded={expanded.has(row.path)}
                onToggleExpand={() => setExpanded(toggle(expanded, row.path))}
                onImportField={(field, value) => importField.mutate({ row, field, value })}
                onExportToDisk={() => exportRowToDisk.mutate(row)}
                onExportTags={(target) => exportTags.mutate(target)}
              />
            ))}
          </section>
        );
      })}

      <button className="uts-showall" onClick={() => setShowInSync(!showInSync)}>
        {showInSync ? 'Hide' : 'Show'} {inSync.length} in-sync tracks
      </button>
      {showInSync && inSync.map((row) => (
        <div key={row.path} className="uts-card">
          <div className="uts-row uts-row-insync">
            <span className="uts-checkbox-spacer" />
            <PresenceBadges row={row} />
            <div className="uts-track">
              <div className="uts-title">{row.title || row.path}</div>
              <div className="uts-sub">{row.artist}</div>
            </div>
            <span className="uts-insync-check">✓ in sync</span>
          </div>
        </div>
      ))}

      <div className="uts-maintenance">
        <button
          className="uts-btn uts-btn-ghost"
          onClick={() => window.confirm('Delete and recreate the Engine "manaDJ Tags" playlist tree?') && rebuildTagTree.mutate()}
        >
          Rebuild Engine tag tree
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- pieces

function PresenceBadges({ row }: { row: StatusRow }) {
  return (
    <span className="uts-badges">
      {PRESENCE_ORDER.map((sid) => (
        <span key={sid} className={`uts-badge ${row.presence[sid] ? 'uts-badge-present' : 'uts-badge-missing'}`}>
          {sid}
        </span>
      ))}
    </span>
  );
}

function GroupActions({ status, selected, onExportEngine, onExportRekordbox, onImportRekordbox, onImportFiles }: {
  status: RowStatus;
  selected: StatusRow[];
  onExportEngine: () => void;
  onExportRekordbox: (dry: boolean) => void;
  onImportRekordbox: (dry: boolean) => void;
  onImportFiles: (paths: string[]) => void;
}) {
  if (status === 'missing-downstream') {
    // existing export operations act on all missing tracks, not a selection
    return (
      <span className="uts-group-actions">
        <button className="uts-btn" onClick={onExportEngine}>Export all → Engine (RBXML)</button>
        <button className="uts-btn" onClick={() => onExportRekordbox(true)}>Export all → Rekordbox (dry-run)</button>
        <button className="uts-btn" onClick={() => window.confirm('Export all missing tracks to Rekordbox?') && onExportRekordbox(false)}>apply</button>
      </span>
    );
  }
  if (status === 'not-in-library') {
    return (
      <span className="uts-group-actions">
        <button className="uts-btn" onClick={() => onImportRekordbox(true)}>Import all ← Rekordbox (dry-run)</button>
        <button className="uts-btn" onClick={() => window.confirm('Import all Rekordbox-only tracks into the Library?') && onImportRekordbox(false)}>apply</button>
      </span>
    );
  }
  if (status === 'unimported' && selected.length > 0) {
    return (
      <span className="uts-group-actions">
        <button className="uts-btn" onClick={() => onImportFiles(selected.map((r) => r.path))}>
          Import {selected.length} selected
        </button>
      </span>
    );
  }
  return null;
}

function RowCard({ row, selected, onSelect, expanded, onToggleExpand, onImportField, onExportToDisk, onExportTags }: {
  row: StatusRow;
  selected: boolean;
  onSelect: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onImportField: (field: string, value: unknown) => void;
  onExportToDisk: () => void;
  onExportTags: (target: 'engine' | 'rekordbox') => void;
}) {
  const expandable = row.diverged.length > 0;
  return (
    <div className={`uts-card ${row.unprocessed ? 'uts-warn' : ''}`}>
      <div className={`uts-row ${expandable ? 'uts-row-expandable' : ''}`} onClick={expandable ? onToggleExpand : undefined}>
        <input type="checkbox" checked={selected} onChange={onSelect} onClick={(e) => e.stopPropagation()} />
        {expandable && <span className={`uts-chevron ${expanded ? 'uts-chevron-open' : ''}`}>▸</span>}
        <PresenceBadges row={row} />
        <div className="uts-track">
          <div className="uts-title">{row.title || row.path}</div>
          <div className="uts-sub">
            {row.artist}
            {row.diverged.length > 0 && (
              <span className="uts-field-tags">
                {row.diverged.map((d) => <code key={d.field}>{d.field}</code>)}
              </span>
            )}
            {row.unprocessed && row.track_id !== null && (
              <span className="uts-unprocessed">unprocessed — exports with no tags</span>
            )}
            {row.warnings.map((w) => <span key={w} className="uts-warning-text">⚠ {w}</span>)}
          </div>
        </div>
      </div>
      {expanded && expandable && (
        <div className="uts-expand">
          <DivergenceMatrix row={row} onImportField={onImportField} />
          <div className="uts-expand-actions">
            {row.diverged.some((d) => !d.no_overwrite && 'disk' in d.surface_values) && (
              <button className="uts-btn" onClick={onExportToDisk}>Export fields → Disk</button>
            )}
            {row.diverged.some((d) => d.field === 'tags' && 'engine' in d.surface_values) && (
              <button className="uts-btn" onClick={() => onExportTags('engine')}>Export tags → Engine</button>
            )}
            {row.diverged.some((d) => d.field === 'tags' && 'rekordbox' in d.surface_values) && (
              <button className="uts-btn" onClick={() => onExportTags('rekordbox')}>Export tags → Rekordbox</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DivergenceMatrix({ row, onImportField }: {
  row: StatusRow;
  onImportField: (field: string, value: unknown) => void;
}) {
  return (
    <table className="uts-matrix">
      <thead>
        <tr>
          <th />
          <th className="uts-matrix-lib">Library</th>
          {EXTERNAL_SURFACES.map((s) => <th key={s.id}>{s.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {row.diverged.map((d) => (
          <tr key={d.field}>
            <td className="uts-fieldname">{d.field}{d.no_overwrite && <span title="Library is empty; Export skips this field"> ⚠</span>}</td>
            <td className="uts-matrix-lib">
              {d.field === 'tags'
                ? (d.library_value as string[]).map((t) => <span key={t} className="uts-tagchip uts-tagchip-both">{t}</span>)
                : fmtValue(d.field, d.library_value) || <span className="uts-novalue">no value</span>}
            </td>
            {EXTERNAL_SURFACES.map((s) => {
              if (!row.presence[s.id]) return <td key={s.id} className="uts-na">·</td>;
              if (!(s.id in d.surface_values)) return <td key={s.id} className="uts-agree">✓</td>;
              const v = d.surface_values[s.id];
              if (d.field === 'tags') {
                return <td key={s.id}><TagDiff library={d.library_value as string[]} here={v as string[]} /></td>;
              }
              return (
                <td key={s.id} className="uts-conflict">
                  {fmtValue(d.field, v) || <span className="uts-novalue">no value</span>}
                  {row.track_id !== null && v !== null && (
                    <button className="uts-microbtn" onClick={() => onImportField(d.field, v)}>← import</button>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TagDiff({ library, here }: { library: string[]; here: string[] }) {
  const union = [...new Set([...library, ...here])];
  return (
    <span className="uts-tagdiff">
      {union.map((tag) => {
        const inLib = library.includes(tag);
        const isHere = here.includes(tag);
        const cls = inLib && isHere ? 'both' : inLib ? 'missing-here' : 'extra-here';
        return <span key={tag} className={`uts-tagchip uts-tagchip-${cls}`}>{tag}</span>;
      })}
    </span>
  );
}
