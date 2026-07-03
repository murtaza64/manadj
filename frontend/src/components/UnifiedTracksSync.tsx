/**
 * Unified Tracks sync view (see .scratch/unified-sync-view/PRD.md).
 *
 * One row per track matched across Surfaces (disk / library / engine /
 * rekordbox), inbox-style: attention rows grouped by status, expandable
 * divergence matrix, per-section actions with a scope-confirm flow
 * (the view is the preview; post-apply refresh is the verification —
 * PRD Story 15, revised).
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

// fields whose "← import" path is actually wired in this UI
// (tags import is deliberately deferred — see PRD out-of-scope + issues/02)
const IMPORTABLE_UI_FIELDS = new Set(['title', 'artist', 'bpm', 'key', 'energy']);

const GROUPS: { status: RowStatus; label: string; chip: string }[] = [
  { status: 'missing-downstream', label: 'Missing downstream', chip: 'missing' },
  { status: 'diverged', label: 'Diverged fields', chip: 'diverged' },
  { status: 'not-in-library', label: 'Not in Library', chip: 'import' },
  { status: 'unimported', label: 'Unimported files', chip: 'unimported' },
];

interface PendingAction {
  scope: string; // what will be acted on
  sideEffects: string; // what kind of writes happen where
  run: () => void;
}

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
  const [pending, setPending] = useState<PendingAction | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  const done = (msg: string) => {
    setNotice(msg);
    setPending(null);
    setSelected(new Set());
    refresh();
  };

  const generateRbxml = useMutation({
    mutationFn: () => api.syncTracks.syncEngineRBXML({ validate_files: true }),
    onSuccess: (r) =>
      done(
        `RBXML generated${r.output_path ? ` at ${r.output_path}` : ''} (${r.missing_in_target_count ?? '?'} tracks). ` +
        'Import it in Engine DJ (Import → Rekordbox XML); rows stay "missing downstream" until then.',
      ),
  });
  const rekordboxSync = useMutation({
    mutationFn: (direction: 'export' | 'import') =>
      api.syncTracks.syncRekordbox({
        dry_run: false,
        skip_import: direction === 'export',
        skip_export: direction === 'import',
      }),
    onSuccess: (_r, direction) =>
      done(direction === 'export' ? 'Exported to Rekordbox' : 'Imported from Rekordbox'),
  });
  const importFiles = useMutation({
    mutationFn: (filepaths: string[]) => api.libraryImport.import({ candidate_filepaths: filepaths }),
    onSuccess: (r) => done(`Imported ${r.imported} files into the Library`),
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
      // mirrors the Export rule (CONTEXT.md): empty Library values are
      // skipped (no_overwrite) — never blanked downstream
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
    onSuccess: () => done('Fields written to file'),
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

  const groupRows = (status: RowStatus) => attention.filter((r) => r.status === status);

  const groupActions = (status: RowStatus, list: StatusRow[], selectedHere: StatusRow[]) => {
    if (status === 'missing-downstream') {
      const missingRb = list.filter((r) => !r.presence.rekordbox).length;
      return (
        <span className="uts-group-actions">
          {/* nondestructive: generates a file, imported manually in Engine (ADR-0006) */}
          <button className="uts-btn" onClick={() => generateRbxml.mutate()}>
            Generate RBXML for Engine import
          </button>
          {missingRb > 0 && (
            <button
              className="uts-btn"
              onClick={() =>
                setPending({
                  scope: `Export ${missingRb} tracks to Rekordbox (all missing — selection not supported yet)`,
                  sideEffects: `creates ${missingRb} rows in the Rekordbox database`,
                  run: () => rekordboxSync.mutate('export'),
                })
              }
            >
              Export all → Rekordbox
            </button>
          )}
        </span>
      );
    }
    if (status === 'not-in-library') {
      const fromRb = list.filter((r) => r.presence.rekordbox).length;
      return (
        <span className="uts-group-actions">
          {fromRb > 0 && (
            <button
              className="uts-btn"
              onClick={() =>
                setPending({
                  scope: `Import ${fromRb} Rekordbox-only tracks into the Library (all — selection not supported yet)`,
                  sideEffects: `creates ${fromRb} Library tracks`,
                  run: () => rekordboxSync.mutate('import'),
                })
              }
            >
              Import all ← Rekordbox
            </button>
          )}
          {list.some((r) => r.presence.engine && !r.presence.rekordbox) && (
            <span className="uts-hint">engine-only tracks have no import operation yet</span>
          )}
        </span>
      );
    }
    if (status === 'unimported' && selectedHere.length > 0) {
      return (
        <span className="uts-group-actions">
          <button
            className="uts-btn"
            onClick={() =>
              setPending({
                scope: `Import ${selectedHere.length} selected files into the Library`,
                sideEffects: 'creates Library tracks (metadata read from file tags)',
                run: () => importFiles.mutate(selectedHere.map((r) => r.path)),
              })
            }
          >
            Import {selectedHere.length} selected
          </button>
        </span>
      );
    }
    return null;
  };

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
        <button
          className={`uts-chip uts-chip-insync ${showInSync ? 'uts-chip-active' : ''}`}
          onClick={() => setShowInSync(!showInSync)}
        >
          <b>{data.counts['in-sync']}</b> in sync
        </button>
        <span className="uts-surfaces-note">
          surfaces: {data.surfaces_available.join(', ') || 'none reachable'}
        </span>
      </div>

      {pending && (
        <div className="uts-pending">
          <div>
            <b>{pending.scope}</b>
            <div className="uts-pending-side">{pending.sideEffects}</div>
          </div>
          <button className="uts-btn" onClick={pending.run}>Apply</button>
          <button className="uts-btn uts-btn-ghost" onClick={() => setPending(null)}>Cancel</button>
        </div>
      )}
      {notice && <div className="uts-notice" onClick={() => setNotice(null)}>{notice} ✕</div>}

      {GROUPS.filter((g) => (!filter || filter === g.status) && groupRows(g.status).length > 0).map((g) => {
        const list = groupRows(g.status);
        const selectable = g.status === 'unimported'; // only op that honors selection
        const selectedHere = list.filter((r) => selected.has(r.path));
        return (
          <section key={g.status} className="uts-group">
            <h3>
              {selectable && (
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
              )}
              {g.label} <span className="uts-count">{list.length}</span>
              {groupActions(g.status, list, selectedHere)}
            </h3>
            {list.map((row) => (
              <RowCard
                key={row.path}
                row={row}
                selectable={selectable}
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

      {showInSync && inSync.map((row) => (
        <div key={row.path} className="uts-card">
          <div className="uts-row uts-row-insync">
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
          onClick={() =>
            setPending({
              scope: 'Rebuild the Engine "manaDJ Tags" playlist tree from scratch',
              sideEffects: 'deletes and recreates the tag playlists in the Engine DJ database',
              run: () => rebuildTagTree.mutate(),
            })
          }
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

function RowCard({ row, selectable, selected, onSelect, expanded, onToggleExpand, onImportField, onExportToDisk, onExportTags }: {
  row: StatusRow;
  selectable: boolean;
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
        {selectable && (
          <input type="checkbox" checked={selected} onChange={onSelect} onClick={(e) => e.stopPropagation()} />
        )}
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
              const canImport =
                row.track_id !== null &&
                d.importable_from.includes(s.id) &&
                IMPORTABLE_UI_FIELDS.has(d.field);
              if (d.field === 'tags') {
                return <td key={s.id}><TagDiff library={d.library_value as string[]} here={v as string[]} /></td>;
              }
              return (
                <td key={s.id} className="uts-conflict">
                  {fmtValue(d.field, v) || <span className="uts-novalue">no value</span>}
                  {canImport && (
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
