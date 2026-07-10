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
import {
  PerfDiffViewer,
  type BeatgridVal,
  type HotCueVal,
  type PerfDiffSides,
} from './PerfDiffViewer';
import { CUE_TIME_TOLERANCE_S } from '../utils/perfDiffOverlay';
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

type PerfField = 'hotcues' | 'beatgrid' | 'maincue';
type PerfImportMode = 'fill-empty' | 'replace-all' | 'replace';

interface BulkPendingItem {
  track_id: number;
  title: string | null;
  artist: string | null;
  field: string;
  detail: string;
  variable: boolean | null;
}

interface StatusRow {
  path: string;
  title: string | null;
  artist: string | null;
  track_id: number | null;
  presence: Record<PresenceId, boolean>;
  status: RowStatus;
  unprocessed: boolean;
  /** Archived (CONTEXT.md): Matched but out of the active Library — never
   * in inbox sections (rolls up in-sync); reachable via divergence chips. */
  archived: boolean;
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

type GroupKey =
  | 'missing-downstream' | 'div-tags' | 'unimported'
  | 'div-title-artist' | 'div-perf' | 'not-in-library' | 'div-bpm-key' | 'div-maincue';

// priority order agreed 2026-07-02, perf tiering revised 2026-07-04:
// beatgrid/hot-cue and key divergences matter more than maincue-only rows —
// gig main cues diverge in bulk and would otherwise bury everything else
const GROUPS: { key: GroupKey; label: string; chip: string; collapsedByDefault?: boolean }[] = [
  { key: 'missing-downstream', label: 'Missing downstream', chip: 'missing' },
  { key: 'div-tags', label: 'Tags diverged', chip: 'diverged' },
  { key: 'unimported', label: 'Unimported files', chip: 'unimported' },
  { key: 'div-title-artist', label: 'Title / artist diverged', chip: 'diverged' },
  { key: 'div-perf', label: 'Beatgrid / hot cues diverged', chip: 'diverged' },
  { key: 'not-in-library', label: 'Not in Library', chip: 'import' },
  { key: 'div-bpm-key', label: 'BPM / key diverged', chip: 'diverged-low', collapsedByDefault: true },
  { key: 'div-maincue', label: 'Main cue diverged', chip: 'diverged-low', collapsedByDefault: true },
];

/** Which section a row belongs to. Diverged rows go to their highest-priority
 * category (a row appears exactly once). */
function groupKeyFor(row: StatusRow): GroupKey | null {
  if (row.status === 'in-sync') return null;
  if (row.status !== 'diverged') return row.status;
  const fields = new Set(row.diverged.map((d) => d.field));
  // energy rides with tags: the Rekordbox tag-export op writes energy colors
  if (fields.has('tags') || fields.has('energy')) return 'div-tags';
  if (fields.has('title') || fields.has('artist')) return 'div-title-artist';
  if (fields.has('hotcues') || fields.has('beatgrid')) return 'div-perf';
  if (fields.has('bpm') || fields.has('key')) return 'div-bpm-key';
  return 'div-maincue'; // maincue-only: lowest tier
}

// Divergence-filter predicates (CONTEXT.md "Divergence filter"): an active
// chip matches EVERY row carrying that divergence, regardless of which Sync
// inbox section claimed it — unlike groupKeyFor, which files each row once.
const CHIP_FIELDS: Partial<Record<GroupKey, string[]>> = {
  'div-tags': ['tags', 'energy'],
  'div-title-artist': ['title', 'artist'],
  'div-perf': ['beatgrid', 'hotcues'],
  'div-bpm-key': ['bpm', 'key'],
  'div-maincue': ['maincue'],
};

function chipMatches(row: StatusRow, key: GroupKey): boolean {
  const fields = CHIP_FIELDS[key];
  if (fields) return row.diverged.some((d) => fields.includes(d.field));
  return row.status === key; // status chips (missing-downstream, unimported, not-in-library)
}

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
  const { data, isLoading, error, isFetching } = useQuery({ queryKey: ['sync-status'], queryFn: fetchStatus });

  const [filter, setFilter] = useState<GroupKey | null>(null);
  const [showInSync, setShowInSync] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(GROUPS.filter((g) => g.collapsedByDefault).map((g) => g.key)),
  );
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [bulkPanel, setBulkPanel] = useState<BulkPendingItem[] | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  // Imports rewrite Track rows / beatgrids / hot cues that the rest of the
  // app caches aggressively (['beatgrid', id] is staleTime: Infinity, and a
  // loaded Deck's Quantize grid + jump tempo follow those queries) — every
  // import path must invalidate what it touched, or waveform beat lines,
  // BPM readouts and deck snapping serve pre-import data until a reload
  // (cue-quantize-bpm 02). No trackId = a bulk import: invalidate by prefix.
  const invalidateTrackCaches = (trackId?: number) => {
    void queryClient.invalidateQueries({
      queryKey: trackId != null ? ['track', trackId] : ['track'],
    });
    void queryClient.invalidateQueries({ queryKey: ['tracks'] });
    void queryClient.invalidateQueries({ queryKey: ['playlist'] });
  };
  const invalidatePerfCaches = (trackId?: number) => {
    void queryClient.invalidateQueries({
      queryKey: trackId != null ? ['beatgrid', trackId] : ['beatgrid'],
    });
    // Prefix-wide even for one track (issue 43): the set views read cues
    // through the ['hotcues', 'bulk', ids] query, which per-id
    // invalidation would miss.
    void queryClient.invalidateQueries({ queryKey: ['hotcues'] });
    invalidateTrackCaches(trackId);
  };
  const done = (msg: string) => {
    setNotice(msg);
    setPending(null);
    setSelected(new Set());
    refresh();
  };
  const failed = (e: unknown) => {
    setNotice(`⚠ ${e instanceof Error ? e.message : String(e)}`);
    setPending(null);
  };

  const generateRbxml = useMutation({
    mutationFn: () => api.trackSync.syncEngineRBXML({ validate_files: true }),
    onSuccess: (r) =>
      done(
        `RBXML generated${r.output_path ? ` at ${r.output_path}` : ''} (${r.exported_to_target ?? '?'} tracks). ` +
        'Import it in Engine DJ (Import → Rekordbox XML); rows stay "missing downstream" until then.',
      ),
    onError: failed,
  });
  const rekordboxSync = useMutation({
    mutationFn: (direction: 'export' | 'import') =>
      api.trackSync.syncRekordbox({
        dry_run: false,
        validate_files: true,
        skip_import: direction === 'export',
        skip_export: direction === 'import',
      }),
    onSuccess: (_r, direction) => {
      if (direction === 'import') invalidateTrackCaches();
      done(direction === 'export' ? 'Exported to Rekordbox' : 'Imported from Rekordbox');
    },
    onError: failed,
  });
  const importFiles = useMutation({
    mutationFn: (filepaths: string[]) => api.libraryImport.import({ candidate_filepaths: filepaths }),
    onSuccess: (r) => {
      invalidateTrackCaches();
      done(`Imported ${r.imported} files into the Library`);
    },
    onError: failed,
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
    onSuccess: (_r, vars) => {
      invalidateTrackCaches(vars.row.track_id!);
      done('Field imported');
    },
    onError: failed,
  });
  const importPerf = useMutation({
    mutationFn: ({ trackId, field, mode }: { trackId: number; field: PerfField; mode: PerfImportMode }) => {
      if (field === 'hotcues') {
        return api.syncPerformance.importHotcues({
          track_id: trackId, mode: mode as 'fill-empty' | 'replace-all',
        }).then((r) =>
          `Hot cues imported: ${r.imported} added` +
          (r.deleted ? `, ${r.deleted} replaced` : '') +
          (r.skipped ? `, ${r.skipped} slots kept` : ''));
      }
      const call = field === 'beatgrid'
        ? api.syncPerformance.importBeatgrid
        : api.syncPerformance.importMaincue;
      return call({ track_id: trackId, mode: mode as 'fill-empty' | 'replace' }).then((r) =>
        r.imported
          ? `${field === 'beatgrid' ? 'Beatgrid' : 'Main cue'} imported from Engine`
          : `Not imported: ${r.reason}`);
    },
    onSuccess: (msg, vars) => {
      invalidatePerfCaches(vars.trackId);
      done(msg);
    },
    onError: failed,
  });
  const bulkImportPerf = useMutation({
    mutationFn: (body: {
      track_ids: number[] | null;
      overwrites?: { track_id: number; field: string; mode?: 'fill-empty' | 'replace-all' }[];
    }) => api.syncPerformance.bulkImport(body),
    onSuccess: (r, vars) => {
      const total = r.applied.hotcues + r.applied.beatgrid + r.applied.maincue + r.applied.key;
      // Even the pending-confirmation branch already applied the automatic
      // tier server-side — invalidate in both branches.
      invalidatePerfCaches();
      const wasConfirmStep = (vars.overwrites?.length ?? 0) > 0;
      if (r.pending.length > 0 && !wasConfirmStep) {
        // automatic tier done; saved info needs per-item confirmation
        setNotice(
          `Filled ${total} blank field${total === 1 ? '' : 's'} from Engine ` +
          `(${r.matched}/${r.scanned} tracks matched); ` +
          `${r.pending.length} overwrite${r.pending.length === 1 ? '' : 's'} awaiting confirmation below`,
        );
        setBulkPanel(r.pending);
        refresh();
      } else {
        setBulkPanel(null);
        done(`Imported ${total} field${total === 1 ? '' : 's'} from Engine`);
      }
    },
    onError: failed,
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
      return api.tracks.writeMetadataToFiles({
        updates: [{ track_id: row.track_id!, fields }],
        dry_run: false,
      });
    },
    onSuccess: () => done('Fields written to file'),
    onError: failed,
  });
  const exportKeyToRb = useMutation({
    mutationFn: (row: StatusRow) =>
      api.syncExport.exportKeyToRekordbox({ track_id: row.track_id! }),
    onSuccess: (r) => {
      done(`Key ${r.key} exported to Rekordbox`);
      refresh();
    },
    onError: failed,
  });
  const exportTags = useMutation({
    mutationFn: (target: 'engine' | 'rekordbox') =>
      target === 'engine'
        ? api.tagSync.syncToEngine({ target, dry_run: false })
        : api.tagSync.syncToRekordbox({ target, dry_run: false }),
    onSuccess: () => done('Tags exported'),
    onError: failed,
  });
  const rebuildTagTree = useMutation({
    mutationFn: () => api.tagSync.syncToEngine({ target: 'engine', dry_run: false, fresh: true }),
    onSuccess: () => done('Engine tag tree rebuilt'),
    onError: failed,
  });

  const busy =
    generateRbxml.isPending || rekordboxSync.isPending || importFiles.isPending ||
    importField.isPending || importPerf.isPending || bulkImportPerf.isPending ||
    exportRowToDisk.isPending || exportKeyToRb.isPending ||
    exportTags.isPending || rebuildTagTree.isPending;

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

  const groupRows = (key: GroupKey) => attention.filter((r) => groupKeyFor(r) === key);
  // predicate counts — the honest "how many tracks are affected" numbers
  const chipRows = (key: GroupKey) => attention.filter((r) => chipMatches(r, key));

  const groupActions = (key: GroupKey, list: StatusRow[], selectedHere: StatusRow[]) => {
    if (key === 'div-tags') {
      // energy rides with tags: the tag exports also write energy (Rekordbox
      // colors, Engine star ratings), so energy-only divergences must still
      // surface these buttons
      const forTarget = (t: 'engine' | 'rekordbox') =>
        list.filter((r) =>
          r.diverged.some(
            (d) => (d.field === 'tags' || d.field === 'energy') && t in d.surface_values,
          ),
        ).length;
      return (
        <span className="uts-group-actions">
          {(['engine', 'rekordbox'] as const).map((t) => {
            const n = forTarget(t);
            if (n === 0) return null;
            const label = t === 'engine' ? 'Engine' : 'Rekordbox';
            return (
              <button
                key={t}
                className="uts-btn"
                onClick={() =>
                  setPending({
                    scope: `Export all tag assignments to ${label} (whole-library operation; clears ${n} rows here)`,
                    sideEffects:
                      t === 'engine'
                        ? 'updates the "manaDJ Tags" playlist tree (and energy star ratings) in the Engine DJ database'
                        : 'updates MyTags (and energy colors) in the Rekordbox database',
                    run: () => exportTags.mutate(t),
                  })
                }
              >
                Export tags → {label}
              </button>
            );
          })}
        </span>
      );
    }
    if (key === 'missing-downstream') {
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
    if (key === 'not-in-library') {
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
    if (key === 'div-perf' || key === 'div-maincue') {
      // fill-empty tier needs no confirmation (PRD); overwrites come back
      // as the confirm panel
      return (
        <span className="uts-group-actions">
          <button
            className="uts-btn"
            onClick={() =>
              bulkImportPerf.mutate({
                track_ids: list.map((r) => r.track_id!).filter((id) => id !== null),
              })
            }
          >
            Import performance data ← Engine
          </button>
        </span>
      );
    }
    if (key === 'unimported' && selectedHere.length > 0) {
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

  const renderRow = (row: StatusRow, selectable: boolean) => (
    <RowCard
      key={row.path}
      row={row}
      selectable={selectable}
      selected={selected.has(row.path)}
      onSelect={() => setSelected(toggle(selected, row.path))}
      expanded={expanded.has(row.path)}
      onToggleExpand={() => setExpanded(toggle(expanded, row.path))}
      onImportField={(field, value) => importField.mutate({ row, field, value })}
      onImportPerf={(field, mode) => {
        const d = row.diverged.find((dd) => dd.field === field);
        const lib = d?.library_value;
        const overwriting =
          mode !== 'fill-empty' &&
          (field === 'hotcues'
            ? ((lib as HotCueVal[] | undefined)?.length ?? 0) > 0
            : lib !== null && lib !== undefined);
        const run = () => importPerf.mutate({ trackId: row.track_id!, field, mode });
        // no silent overwrites: replacing saved info goes through
        // the pending-confirm flow; fill-empty never overwrites
        if (!overwriting) return run();
        const what =
          field === 'hotcues'
            ? `${(lib as HotCueVal[]).length} saved hot cue${(lib as HotCueVal[]).length === 1 ? '' : 's'}`
            : field === 'beatgrid' ? 'the saved beatgrid' : 'the saved main cue';
        const engineGrid = field === 'beatgrid'
          ? (d?.surface_values['engine'] as BeatgridVal | undefined) : undefined;
        const variable = engineGrid && engineGrid.tempo_changes.length > 1
          ? ` (variable grid — ${engineGrid.tempo_changes.length} tempo changes; rendering honors only the first for now)` : '';
        setPending({
          scope: `Replace ${what} on "${row.title || row.path}" with Engine's${variable}`,
          sideEffects: 'overwrites saved performance data in the Library',
          run,
        });
      }}
      onBulkImportPerf={() => bulkImportPerf.mutate({ track_ids: [row.track_id!] })}
      onExportToDisk={() => exportRowToDisk.mutate(row)}
      onExportKeyToRb={() =>
        // writes an external DB: always behind the pending-confirm bar
        setPending({
          scope: `Overwrite the key in Rekordbox for "${row.title || row.path}" with the Library's`,
          sideEffects: 'writes to the Rekordbox database (Rekordbox must be closed)',
          run: () => exportKeyToRb.mutate(row),
        })
      }
      surfacesAvailable={data.surfaces_available}
    />
  );

  return (
    <div className="uts-root">
      <div className="uts-chipbar">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            className={`uts-chip uts-chip-${g.chip} ${filter === g.key ? 'uts-chip-active' : ''}`}
            onClick={() => setFilter(filter === g.key ? null : g.key)}
            title="Count of all affected tracks; click to list them regardless of section"
          >
            <b>{chipRows(g.key).length}</b> {g.label.toLowerCase()}
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
        <button className="uts-btn uts-btn-ghost" onClick={() => refresh()} disabled={isFetching}>
          {isFetching ? 'refreshing…' : '↻ refresh'}
        </button>
      </div>

      {busy && <div className="uts-busy">working…</div>}
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
      {bulkPanel && (
        <BulkConfirmPanel
          items={bulkPanel}
          busy={busy}
          onCancel={() => setBulkPanel(null)}
          onApply={(overwrites) =>
            bulkImportPerf.mutate({
              track_ids: [...new Set(overwrites.map((o) => o.track_id))],
              overwrites,
            })
          }
        />
      )}

      {filter ? (
        /* Divergence filter (glossary): flat predicate view — every matching
           row, regardless of which inbox section claimed it. */
        (() => {
          const g = GROUPS.find((gg) => gg.key === filter)!;
          const list = chipRows(filter);
          const selectable = filter === 'unimported';
          const selectedHere = list.filter((r) => selected.has(r.path));
          return (
            <section className="uts-group">
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
                {list.length} track{list.length === 1 ? '' : 's'} — {g.label.toLowerCase()}
                {groupActions(filter, list, selectedHere)}
              </h3>
              {list.length === 0 && <div className="uts-empty">nothing matches</div>}
              {list.map((row) => renderRow(row, selectable))}
            </section>
          );
        })()
      ) : (
        /* Sync inbox (glossary): priority sections, each row exactly once. */
        GROUPS.filter((g) => groupRows(g.key).length > 0).map((g) => {
          const list = groupRows(g.key);
          const selectable = g.key === 'unimported'; // only op that honors selection
          const selectedHere = list.filter((r) => selected.has(r.path));
          const isCollapsed = collapsed.has(g.key);
          return (
            <section key={g.key} className="uts-group">
              <h3>
                <button
                  className="uts-collapse-toggle"
                  onClick={() => setCollapsed(toggle(collapsed, g.key))}
                  title={isCollapsed ? 'Expand section' : 'Collapse section'}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
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
                {groupActions(g.key, list, selectedHere)}
              </h3>
              {!isCollapsed && list.map((row) => renderRow(row, selectable))}
            </section>
          );
        })
      )}

      {showInSync && inSync.map((row) => (
        <div key={row.path} className="uts-card">
          <div className="uts-row uts-row-insync">
            <PresenceBadges row={row} available={data.surfaces_available} />
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
          onClick={() => bulkImportPerf.mutate({ track_ids: null })}
          title="Fills blanks (hot cues, beatgrids, main cues, keys) from Engine across the whole Library; overwrites of saved info will ask first"
        >
          Import performance data ← Engine (whole library)
        </button>
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

/** The confirm tier of the bulk performance-data import: every item is an
 * overwrite of saved info — nothing here applies without being checked. */
function BulkConfirmPanel({ items, busy, onApply, onCancel }: {
  items: BulkPendingItem[];
  busy: boolean;
  onApply: (overwrites: { track_id: number; field: string; mode?: 'fill-empty' | 'replace-all' }[]) => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set(items.map((_, i) => i)));
  const [cueModes, setCueModes] = useState<Record<number, 'fill-empty' | 'replace-all'>>({});

  const toggle = (i: number) => {
    const next = new Set(checked);
    if (next.has(i)) { next.delete(i); } else { next.add(i); }
    setChecked(next);
  };
  const allChecked = checked.size === items.length;

  return (
    <div className="uts-pending uts-bulk-panel">
      <div className="uts-bulk-head">
        <b>{items.length} overwrite{items.length === 1 ? '' : 's'} of saved info — confirm to apply</b>
        <button
          className="uts-microbtn"
          onClick={() => setChecked(allChecked ? new Set() : new Set(items.map((_, i) => i)))}
        >
          {allChecked ? 'select none' : 'select all'}
        </button>
      </div>
      <div className="uts-bulk-list">
        {items.map((item, i) => (
          <label key={`${item.track_id}-${item.field}`} className="uts-bulk-item">
            <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} />
            <span className="uts-bulk-track">{item.title || `#${item.track_id}`}{item.artist ? ` — ${item.artist}` : ''}</span>
            <code>{item.field}</code>
            <span className="uts-bulk-detail">
              {item.detail}
              {item.variable && (
                <span title="manadj rendering honors only the first tempo change for now"> ⚠</span>
              )}
            </span>
            {item.field === 'hotcues' && checked.has(i) && (
              <select
                value={cueModes[i] ?? 'fill-empty'}
                onChange={(e) => setCueModes({ ...cueModes, [i]: e.target.value as 'fill-empty' | 'replace-all' })}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="fill-empty">fill empty slots</option>
                <option value="replace-all">replace all</option>
              </select>
            )}
          </label>
        ))}
      </div>
      <div className="uts-bulk-actions">
        <button
          className="uts-btn"
          disabled={busy || checked.size === 0}
          onClick={() =>
            onApply(
              [...checked].map((i) => ({
                track_id: items[i].track_id,
                field: items[i].field,
                ...(items[i].field === 'hotcues' ? { mode: cueModes[i] ?? 'fill-empty' } : {}),
              })),
            )
          }
        >
          Apply {checked.size} overwrite{checked.size === 1 ? '' : 's'}
        </button>
        <button className="uts-btn uts-btn-ghost" onClick={onCancel}>Dismiss</button>
      </div>
    </div>
  );
}

function PresenceBadges({ row, available }: { row: StatusRow; available: SurfaceId[] }) {
  return (
    <span className="uts-badges">
      {PRESENCE_ORDER.map((sid) => {
        const unknown = sid !== 'library' && !available.includes(sid as SurfaceId);
        const cls = unknown
          ? 'uts-badge-unknown'
          : row.presence[sid] ? 'uts-badge-present' : 'uts-badge-missing';
        return (
          <span
            key={sid}
            title={unknown ? `${sid}: unreachable (close the app holding its database?)` : `${sid}: ${row.presence[sid] ? 'present' : 'missing'}`}
            className={`uts-badge ${cls}`}
          >
            {sid}
          </span>
        );
      })}
    </span>
  );
}

function RowCard({ row, selectable, selected, onSelect, expanded, onToggleExpand, onImportField, onImportPerf, onBulkImportPerf, onExportToDisk, onExportKeyToRb, surfacesAvailable }: {
  row: StatusRow;
  surfacesAvailable: SurfaceId[];
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onImportField: (field: string, value: unknown) => void;
  onImportPerf: (field: PerfField, mode: PerfImportMode) => void;
  onBulkImportPerf: () => void;
  onExportToDisk: () => void;
  onExportKeyToRb: () => void;
}) {
  const expandable = row.diverged.length > 0;
  const [showViewer, setShowViewer] = useState(false);
  const hasPerfDivergence =
    row.track_id !== null &&
    row.diverged.some((d) => ['hotcues', 'beatgrid', 'maincue'].includes(d.field));
  return (
    <div className={`uts-card ${row.unprocessed ? 'uts-warn' : ''}`}>
      <div className={`uts-row ${expandable ? 'uts-row-expandable' : ''}`} onClick={expandable ? onToggleExpand : undefined}>
        {selectable && (
          <input type="checkbox" checked={selected} onChange={onSelect} onClick={(e) => e.stopPropagation()} />
        )}
        {expandable && <span className={`uts-chevron ${expanded ? 'uts-chevron-open' : ''}`}>▸</span>}
        <PresenceBadges row={row} available={surfacesAvailable} />
        <div className="uts-track">
          <div className="uts-title">{row.title || row.path}</div>
          <div className="uts-sub">
            {row.artist}
            {row.diverged.length > 0 && (
              <span className="uts-field-tags">
                {row.diverged.map((d) => (
                  <code
                    key={d.field}
                    title={d.no_overwrite
                      ? `Library has no ${d.field}; Export skips it — import manually if the downstream value is right`
                      : undefined}
                  >
                    {d.field}{d.no_overwrite ? ' ⚠' : ''}
                  </code>
                ))}
              </span>
            )}
            {row.unprocessed && row.track_id !== null && (
              <span className="uts-unprocessed">unprocessed — exports with no tags</span>
            )}
            {row.archived && (
              <span className="uts-archived">archived — out of the active library, not exported</span>
            )}
          </div>
        </div>
      </div>
      {expanded && expandable && (
        <div className="uts-expand">
          <DivergenceMatrix row={row} onImportField={onImportField} onImportPerf={onImportPerf} onExportKeyToRb={onExportKeyToRb} />
          <div className="uts-expand-actions">
            {hasPerfDivergence && (
              <button className="uts-btn" onClick={() => setShowViewer(!showViewer)}>
                {showViewer ? 'Hide visual diff' : 'Visual diff'}
              </button>
            )}
            {row.track_id !== null &&
              row.diverged.some((d) => ['hotcues', 'beatgrid', 'maincue', 'key'].includes(d.field)) && (
              <button className="uts-btn" onClick={onBulkImportPerf} title="Fills blanks automatically; overwrites of saved info will ask first">
                Import performance data ← Engine (this track)
              </button>
            )}
            {row.diverged.some((d) => !d.no_overwrite && 'disk' in d.surface_values) && (
              <button className="uts-btn" onClick={onExportToDisk}>Export fields → Disk</button>
            )}
            {row.diverged.some((d) => d.field === 'tags') && (
              <span className="uts-hint">tag fixes: use the section's "Export tags" buttons (whole-library op)</span>
            )}
          </div>
          {showViewer && hasPerfDivergence && (
            <RowPerfDiff row={row} onImportPerf={onImportPerf} />
          )}
        </div>
      )}
    </div>
  );
}

/** Builds the viewer's two sides from the row's divergences, falling back to
 * Library fetches for non-diverged layers (grid/cues) so the overlay always
 * has beat context. Read-only + pick-a-side (the parent owns confirmation). */
function RowPerfDiff({ row, onImportPerf }: {
  row: StatusRow;
  onImportPerf: (field: PerfField, mode: PerfImportMode) => void;
}) {
  const byField = Object.fromEntries(row.diverged.map((d) => [d.field, d]));
  const gridDiv = byField['beatgrid'];
  const cuesDiv = byField['hotcues'];
  const maincueDiv = byField['maincue'];

  // Library-side context for layers that aren't diverged
  const { data: libGridResp } = useQuery({
    queryKey: ['beatgrid', row.track_id],
    queryFn: () => api.beatgrids.get(row.track_id!),
    enabled: !gridDiv,
    retry: false,
  });
  const { data: libCuesResp } = useQuery({
    queryKey: ['hotcues', row.track_id],
    queryFn: () => api.hotcues.get(row.track_id!),
    enabled: !cuesDiv,
    retry: false,
  });

  const sides: PerfDiffSides = {
    libraryGrid: gridDiv
      ? (gridDiv.library_value as BeatgridVal | null)
      : libGridResp?.data ? { tempo_changes: libGridResp.data.tempo_changes } : null,
    engineGrid: (gridDiv?.surface_values['engine'] as BeatgridVal | undefined) ?? null,
    libraryCues: cuesDiv
      ? (cuesDiv.library_value as HotCueVal[])
      : ((libCuesResp ?? []) as { slot_number: number; time_seconds: number; label: string | null; color: string | null }[])
          .map((c) => ({ slot: c.slot_number, time: c.time_seconds, label: c.label, color: c.color })),
    engineCues: (cuesDiv?.surface_values['engine'] as HotCueVal[] | undefined) ?? [],
    libraryMaincue: (maincueDiv?.library_value as number | null | undefined) ?? null,
    engineMaincue: (maincueDiv?.surface_values['engine'] as number | undefined) ?? null,
  };

  return (
    <PerfDiffViewer
      trackId={row.track_id!}
      sides={sides}
      onImport={{
        hotcues: cuesDiv ? (mode) => onImportPerf('hotcues', mode) : undefined,
        beatgrid: gridDiv
          ? () => onImportPerf('beatgrid', sides.libraryGrid ? 'replace' : 'fill-empty')
          : undefined,
        maincue: maincueDiv
          ? () => onImportPerf('maincue', sides.libraryMaincue !== null ? 'replace' : 'fill-empty')
          : undefined,
      }}
    />
  );
}

function DivergenceMatrix({ row, onImportField, onImportPerf, onExportKeyToRb }: {
  row: StatusRow;
  onImportField: (field: string, value: unknown) => void;
  onImportPerf: (field: PerfField, mode: PerfImportMode) => void;
  onExportKeyToRb: () => void;
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
                : d.field === 'hotcues'
                ? <HotCueChips cues={d.library_value as HotCueVal[]} />
                : d.field === 'beatgrid'
                ? (d.library_value
                    ? <GridSummary grid={d.library_value as BeatgridVal} />
                    : <span className="uts-novalue">no saved grid</span>)
                : d.field === 'maincue'
                ? (d.library_value !== null && d.library_value !== undefined
                    ? fmtCueTimeMs(d.library_value as number)
                    : <span className="uts-novalue">unset</span>)
                : fmtValue(d.field, d.library_value) || <span className="uts-novalue">no value</span>}
            </td>
            {EXTERNAL_SURFACES.map((s) => {
              if (!row.presence[s.id]) return <td key={s.id} className="uts-na">·</td>;
              if (!(s.id in d.surface_values)) {
                // agrees with the Library — but "agreeing" with an empty
                // Library value just means both are empty
                return d.no_overwrite
                  ? <td key={s.id} className="uts-na" title="also has no value">—</td>
                  : <td key={s.id} className="uts-agree">✓</td>;
              }
              const v = d.surface_values[s.id];
              const canImport =
                row.track_id !== null &&
                d.importable_from.includes(s.id) &&
                IMPORTABLE_UI_FIELDS.has(d.field);
              if (d.field === 'tags') {
                return <td key={s.id}><TagDiff library={d.library_value as string[]} here={v as string[]} /></td>;
              }
              if (d.field === 'hotcues') {
                const lib = d.library_value as HotCueVal[];
                const here = v as HotCueVal[];
                const importable = row.track_id !== null && d.importable_from.includes(s.id);
                return (
                  <td key={s.id} className="uts-conflict">
                    <HotCueDiff library={lib} here={here} />
                    {importable && (lib.length === 0 ? (
                      <button className="uts-microbtn" onClick={() => onImportPerf('hotcues', 'fill-empty')}>← import</button>
                    ) : (
                      <>
                        <button className="uts-microbtn" onClick={() => onImportPerf('hotcues', 'fill-empty')}>← fill empty slots</button>
                        <button className="uts-microbtn" onClick={() => onImportPerf('hotcues', 'replace-all')}>← replace all</button>
                      </>
                    ))}
                  </td>
                );
              }
              if (d.field === 'beatgrid') {
                const grid = v as BeatgridVal;
                const importable = row.track_id !== null && d.importable_from.includes(s.id);
                const hasSaved = d.library_value !== null && d.library_value !== undefined;
                return (
                  <td key={s.id} className="uts-conflict">
                    <GridSummary grid={grid} />
                    {importable && (
                      <button
                        className="uts-microbtn"
                        onClick={() => onImportPerf('beatgrid', hasSaved ? 'replace' : 'fill-empty')}
                      >
                        {hasSaved ? '← replace grid' : '← import'}
                      </button>
                    )}
                  </td>
                );
              }
              if (d.field === 'maincue') {
                const importable = row.track_id !== null && d.importable_from.includes(s.id);
                const hasSaved = d.library_value !== null && d.library_value !== undefined;
                return (
                  <td key={s.id} className="uts-conflict">
                    {fmtCueTimeMs(v as number)}
                    {importable && (
                      <button
                        className="uts-microbtn"
                        onClick={() => onImportPerf('maincue', hasSaved ? 'replace' : 'fill-empty')}
                      >
                        {hasSaved ? '← replace cue' : '← import'}
                      </button>
                    )}
                  </td>
                );
              }
              const canExportKey =
                d.field === 'key' &&
                s.id === 'rekordbox' &&
                row.track_id !== null &&
                !d.no_overwrite;
              return (
                <td key={s.id} className="uts-conflict">
                  {fmtValue(d.field, v) || <span className="uts-novalue">no value</span>}
                  {canImport && (
                    <button className="uts-microbtn" onClick={() => onImportField(d.field, v)}>← import</button>
                  )}
                  {canExportKey && (
                    <button className="uts-microbtn" onClick={onExportKeyToRb}>export →</button>
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

// ------------------------------------------------------------- hot cue diff

function fmtCueTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** Millisecond-resolution time for divergence display — comparison
 * tolerances are 1 ms, so anything coarser can render two genuinely
 * diverged values as identical text. */
function fmtCueTimeMs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(3).padStart(6, '0')}`;
}

/** BPM at full stored resolution (4 decimals, trailing zeros trimmed) —
 * BEATGRID_BPM_TOLERANCE is 0.01, so 2 decimals can mask a divergence. */
function fmtBpm(bpm: number): string {
  return bpm.toFixed(4).replace(/\.?0+$/, '');
}

function cuesRoughlyEqual(a: HotCueVal, b: HotCueVal): boolean {
  // mirrors the backend's whole-set semantics (tolerance is authoritative
  // there; this only drives chip coloring)
  return (
    Math.abs(a.time - b.time) <= CUE_TIME_TOLERANCE_S &&
    (a.label || null) === (b.label || null) &&
    (a.color || '').toUpperCase() === (b.color || '').toUpperCase()
  );
}

function CueChip({ cue, cls }: { cue: HotCueVal; cls: string }) {
  return (
    <span
      className={`uts-tagchip uts-tagchip-${cls}`}
      title={`${fmtCueTimeMs(cue.time)}${cue.label ? ` — ${cue.label}` : ''}`}
    >
      {cue.color && <span className="uts-cuedot" style={{ background: cue.color }} />}
      {cue.slot}·{fmtCueTime(cue.time)}{cue.label ? ` ${cue.label}` : ''}
    </span>
  );
}

/** Compact beatgrid rendering: constant grids read as one BPM + start;
 * variable grids get an explicit warning flag (import-time visibility of
 * the first-tempo-change rendering limitation). */
function GridSummary({ grid }: { grid: BeatgridVal }) {
  const changes = grid.tempo_changes;
  if (changes.length === 1) {
    return <span>{fmtBpm(changes[0].bpm)} BPM from {fmtCueTimeMs(changes[0].start_time)}</span>;
  }
  return (
    <span>
      <span className="uts-tagchip uts-tagchip-extra-here" title="manadj rendering honors only the first tempo change for now">
        ⚠ variable grid — {changes.length} tempo changes
      </span>{' '}
      {changes.map((c) => fmtBpm(c.bpm)).join(' → ')} BPM
    </span>
  );
}

function HotCueChips({ cues }: { cues: HotCueVal[] }) {
  if (cues.length === 0) return <span className="uts-novalue">no cues</span>;
  return <span className="uts-tagdiff">{cues.map((c) => <CueChip key={c.slot} cue={c} cls="both" />)}</span>;
}

/** Engine-side cell: chips colored like TagDiff — agreeing cues neutral,
 * Engine-only or Engine-different cues "extra", Library-only cues "missing". */
function HotCueDiff({ library, here }: { library: HotCueVal[]; here: HotCueVal[] }) {
  const slots = [...new Set([...library, ...here].map((c) => c.slot))].sort((a, b) => a - b);
  return (
    <span className="uts-tagdiff">
      {slots.map((slot) => {
        const lib = library.find((c) => c.slot === slot);
        const h = here.find((c) => c.slot === slot);
        if (h && lib && cuesRoughlyEqual(h, lib)) return <CueChip key={slot} cue={h} cls="both" />;
        if (h) return <CueChip key={slot} cue={h} cls="extra-here" />;
        return <CueChip key={slot} cue={lib!} cls="missing-here" />;
      })}
    </span>
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
