import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties, type PointerEvent } from 'react';
import { api } from '../api/client';
import type { ExternalDrive, ExternalDriveCheck, ExternalDriveFieldComparison, ExternalDrivePreview, ExternalDrivePreviewPlaylist, ExternalDrivePullEntry } from '../api/client';
import {
  classifyPlaylist, describeChange, describeResult, fieldsSnapshot, snapshotOfPlaylist, snapshotOfTracks,
  type FieldChoice, type ItemResult, type QueueItem, type RowState,
} from './UnifiedSync';
import { plural } from './plural';
import { ExportImpact } from './ExportImpact';
import { DesktopSourceBrowser } from './DesktopSourceBrowser';
import './SyncBrowser.css';
import { ConstructionNotice } from './ConstructionNotice';
import BPMDisplay from './BPMDisplay';
import { DivergenceIcon } from './icons/DivergenceIcon';
import { KEY_TABLE } from '../utils/keyTable.generated';
import { formatKeyDisplay } from '../utils/keyUtils';
import KeyDisplay from './KeyDisplay';
import { TrackWaveformPreview } from './TrackWaveformPreview';
import './TrackRow.css';
import { useFitColumns } from './FitColumnHeaders';
const SYNC_COLUMN_IDS = ['order', 'title', 'artist', 'bpm', 'key', 'preview', 'library', 'diff'];
const SYNC_COLUMN_SHARES = [6, 24, 14, 7, 6, 13, 18, 12];

/** Sync: the USB library on the left (every playlist, every track), what is out
 * of sync marked beside each item, and one accumulated plan on the right.
 * Drive to library only. The drive is never written. A plan item is bound to its
 * drive and to what was seen when it was chosen, and rechecked right before it runs. */

type Tone = 'ok' | 'work' | 'unknown' | 'none';
export type Marker = { tone: Tone; label: string; hint: string };

export const trackMarker = (e: ExternalDrivePullEntry): Marker => {
  switch (e.status) {
    case 'present': return { tone: 'ok', label: 'In library', hint: 'Same audio found in your library' };
    case 'new': return { tone: 'work', label: 'Not in library', hint: 'No audio match in your library' };
    case 'uncertain': return { tone: 'unknown', label: 'Unverified', hint: 'Name matches, audio does not confirm it' };
    case 'duplicate': return { tone: 'unknown', label: 'Duplicate', hint: 'Appears more than once on the drive' };
    default: return { tone: 'unknown', label: 'File missing', hint: 'The audio file is not on the drive' };
  }
};

/** Short tag for a playlist. The long reason stays in the tooltip. */
export const playlistTag = (s: RowState): { tone: Tone; label: string } => {
  if (s.kind === 'match') return { tone: 'ok', label: 'Matches' };
  if (s.kind === 'work') return { tone: 'work', label: s.action === 'copy' ? 'Not in library' : s.action === 'pair' ? 'Unpaired' : 'Differs' };
  return { tone: 'unknown', label: 'Unknown' };
};

export type DriveSummary = {
  playlists: number; match: number; update: number; look: number;
  unverifiedTracks: number; notInLibraryTracks: number; attention: { id: number; name: string; label: string }[];
};
const folderOf = (p: ExternalDrivePreviewPlaylist) => p.folder_parts ?? (p.folder_path ? [p.folder_path] : []);
const fullName = (p: ExternalDrivePreviewPlaylist) => [...folderOf(p), p.name ?? '(unnamed)'].join(' > ');
export function summarize(preview: ExternalDrivePreview): DriveSummary {
  const dest = !!preview.default_destination?.trim();
  const rows = (preview.playlists ?? []).map((p) => ({ p, s: classifyPlaylist(p, dest) }));
  return {
    playlists: rows.length,
    match: rows.filter((r) => r.s.kind === 'match').length,
    update: rows.filter((r) => r.s.kind === 'work' && r.s.action !== 'pair').length,
    look: rows.filter((r) => r.s.kind === 'unknown' || r.s.kind === 'blocked' || (r.s.kind === 'work' && r.s.action === 'pair')).length,
    unverifiedTracks: preview.uncertain_count ?? 0,
    notInLibraryTracks: preview.new_count ?? 0,
    attention: rows.filter((r) => r.s.kind !== 'match').map((r) => ({ id: r.p.id, name: fullName(r.p), label: r.s.label })),
  };
}

type Read =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; preview: ExternalDrivePreview; readAt: Date };
type DriveData = { read: Read; check: ExternalDriveCheck | null | 'failed'; fields: ExternalDriveFieldComparison | null | 'failed' };
/** A field choice carries the values it was made against, so a changed value never inherits it. */
type Decision = { choice: 'take' | 'keep'; drive: string | number | null; library: string | number | null };
type Plan = { queue: QueueItem[]; decisions: Record<string, Decision>; names: Record<number, string> };
const EMPTY_PLAN: Plan = { queue: [], decisions: {}, names: {} };
const BLANK: DriveData = { read: { state: 'loading' }, check: null, fields: null };

/** Missing playlists first, then differing ones, then unknown, matching last. Array sort is stable, so drive order holds within a group. */
const urgency = (s: RowState) => (s.kind === 'work' ? (s.action === 'copy' ? 0 : 1) : s.kind === 'match' ? 3 : 2);
const FIELD_LABEL: Record<string, string> = { title: 'Title', artist: 'Artist', bpm: 'BPM', key: 'Key' };
const fieldKey = (t: number, f: string) => `${t}:${f}`;

export function SyncBrowser({ toolbar, onPendingChange }: { toolbar?: ReactNode; onPendingChange?: (pending: boolean) => void } = {}) {
  const fit = useFitColumns(SYNC_COLUMN_IDS, SYNC_COLUMN_SHARES);
  const [drives, setDrives] = useState<ExternalDrive[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [desktop, setDesktop] = useState<'engine' | 'rekordbox' | null>(null);
  const [data, setData] = useState<Record<string, DriveData>>({});
  // Plans live per drive root and survive switching drives and views.
  const [planWidth, setPlanWidth] = useState(320);
  const planSidebar = useRef<HTMLElement>(null);
  const resizePlan = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault(); const target = event.currentTarget; target.setPointerCapture(event.pointerId);
    const start = event.clientX, original = planSidebar.current?.getBoundingClientRect().width ?? planWidth;
    const max = Math.min(520, (planSidebar.current?.parentElement?.clientWidth ?? 1000) - 450);
    const move = (e: globalThis.PointerEvent) => setPlanWidth(Math.max(240, Math.min(max, original + start - e.clientX)));
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end);
  };
  const [hoverResult, setHoverResult] = useState<{ key: string; value: string | number | null } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const similarPanel = useRef<HTMLElement>(null);
  const [similarReview, setSimilarReview] = useState<{ seedTrackId: number; field: string; choice: 'take' | 'keep'; changes: FieldChoice[] } | null>(null);
  useEffect(() => { if (similarReview) similarPanel.current?.scrollIntoView?.({ block: 'nearest' }); }, [similarReview]);
  const [selectedOrdinals, setSelectedOrdinals] = useState<Set<number>>(new Set());
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [results, setResults] = useState<Record<string, ItemResult[]>>({});
  const [applying, setApplying] = useState(false);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const navigationLocked = applying || desktopBusy;
  useEffect(() => { onPendingChange?.(navigationLocked); }, [navigationLocked, onPendingChange]);
  const [sel, setSel] = useState<number | 'all'>('all');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const toggleDiff = (key: string) => setExpandedDiffs((previous) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const gens = useRef<Record<string, number>>({});

  const patch = (r: string, f: (d: DriveData) => DriveData) => setData((prev) => ({ ...prev, [r]: f(prev[r] ?? BLANK) }));
  // Each read carries a generation: an older read finishing late never overwrites a newer one.
  const read = useCallback((d: ExternalDrive) => {
    const g = (gens.current[d.root] ?? 0) + 1;
    gens.current[d.root] = g;
    const current = () => gens.current[d.root] === g;
    patch(d.root, () => BLANK);
    api.externalDrives.preview(d.root, undefined, true)
      .then((p) => { if (current()) patch(d.root, (x) => ({ ...x, read: { state: 'ready', preview: p, readAt: new Date() } })); })
      .catch((e) => { if (current()) patch(d.root, (x) => ({ ...x, read: { state: 'error', message: e instanceof Error ? e.message : 'could not be read' } })); });
    if (d.kind === 'rekordbox') {
      api.externalDrives.check(d.root).then((c) => { if (current()) patch(d.root, (x) => ({ ...x, check: c })); }).catch(() => { if (current()) patch(d.root, (x) => ({ ...x, check: 'failed' })); });
      api.externalDrives.fields(d.root).then((f) => { if (current()) patch(d.root, (x) => ({ ...x, fields: f })); }).catch(() => { if (current()) patch(d.root, (x) => ({ ...x, fields: 'failed' })); });
    }
  }, []);

  const detect = useCallback(() => {
    setDetectError(null);
    api.externalDrives.list()
      .then((l) => { setDrives(l); setRoot((cur) => (cur && l.some((d) => d.root === cur) ? cur : l[0]?.root ?? null)); })
      .catch((e) => { setDrives([]); setRoot(null); setDetectError(e instanceof Error ? e.message : 'Drive detection failed'); });
  }, []);
  useEffect(() => { detect(); }, [detect]);

  const drive = drives?.find((d) => d.root === root) ?? null;
  useEffect(() => { if (drive && !data[drive.root]) read(drive); }, [drive, data, read]);
  useEffect(() => { setSel('all'); }, [root]);
  useEffect(() => { setSelectedOrdinals(new Set()); setHoverResult(null); }, [root, sel, issuesOnly]);

  const d = (root && data[root]) || BLANK;
  const plan = (root && plans[root]) || EMPTY_PLAN;
  const setPlan = (f: (p: Plan) => Plan) => { if (root) setPlans((prev) => ({ ...prev, [root]: f(prev[root] ?? EMPTY_PLAN) })); };
  const preview = d.read.state === 'ready' ? d.read.preview : null;
  const fields = d.fields !== 'failed' && d.fields !== null ? d.fields : null;
  const dest = preview?.default_destination ?? '';
  const hasDest = !!dest.trim();
  const playlists = preview?.playlists ?? [];
  const byOrdinal = useMemo(() => new Map((preview?.entries ?? []).map((e) => [e.ordinal, e])), [preview]);
  const fieldTrackByOrdinal = useMemo(() => new Map((fields?.tracks ?? []).map((t) => [t.ordinal, t])), [fields]);
  const selected = sel === 'all' ? null : playlists.find((p) => p.id === sel) ?? null;
  useEffect(() => { if (preview && sel !== 'all' && !selected) setSel('all'); }, [preview, sel, selected]);

  // Field choices: only an explicit "take" whose reviewed values still match enters the plan.
  const applicable: FieldChoice[] = (fields?.tracks ?? []).flatMap((t) => t.fields.filter((f) => f.applicable).map((f) => ({ track_id: t.track_id, field: f.field, label: t.label, drive: f.drive, library: f.library })));
  const decisionFor = (c: { track_id: number; field: string; drive: string | number | null; library: string | number | null }) => {
    const x = plan.decisions[fieldKey(c.track_id, c.field)];
    return x && x.drive === c.drive && x.library === c.library ? x : null;
  };
  // Only undecided differences on verified audio in this playlist are compatible.
  // Existing choices, conflicting sources and read-only fields are never replaced.
  const similarChoices = (seed: FieldChoice) => selected ? applicable.filter(c =>
    c.field === seed.field && !decisionFor(c) &&
    (fields?.tracks ?? []).some(t => t.track_id === c.track_id &&
      selected.track_ordinals?.includes(t.ordinal) && byOrdinal.get(t.ordinal)?.status === 'present')) : [];
  useEffect(() => { setSimilarReview(null); }, [plans, root, sel, issuesOnly, d.read, d.fields, desktop]);
  const stageSimilar = () => {
    if (!similarReview || applying) return;
    const { choice, changes } = similarReview;
    setPlan(p => ({ ...p, decisions: { ...p.decisions, ...Object.fromEntries(changes.map(c =>
      [fieldKey(c.track_id, c.field), { choice, drive: c.drive, library: c.library }])) } }));
    setSimilarReview(null);
  };
  const taking = applicable.filter((c) => decisionFor(c)?.choice === 'take');
  const fieldTrackCount = new Set(taking.map(c => c.track_id)).size;
  const fieldScope = `${plural(fieldTrackCount, 'track')} · ${plural(taking.length, 'metadata field')}`;
  const undecided = applicable.filter((c) => !decisionFor(c)).length;
  const changedChoices = Object.entries(plan.decisions).filter(([k]) => { const [t, f] = k.split(':'); const c = applicable.find((a) => String(a.track_id) === t && a.field === f); return !c || !decisionFor(c); }).length;
  const fieldItem: QueueItem | null = fields && taking.length > 0
    ? { key: 'fields', kind: 'fields', name: plural(taking.length, 'track detail'), snapshot: fieldsSnapshot(fields, taking), changes: taking.map((c) => ({ ...c })) }
    : null;
  useEffect(() => { setReviewing(false); }, [plans, root, d.read, d.fields]);
  const items: QueueItem[] = [...plan.queue, ...(fieldItem ? [fieldItem] : [])];
  const queued = (key: string) => items.some((q) => q.key === key);
  const dequeue = (key: string) => {
    if (key === 'fields') setPlan((p) => ({ ...p, decisions: Object.fromEntries(Object.entries(p.decisions).filter(([, v]) => v.choice !== 'take')) }));
    else setPlan((p) => ({ ...p, queue: p.queue.filter((i) => i.key !== key) }));
  };
  const decide = (c: FieldChoice, choice: 'take' | 'keep') => setPlan((p) => ({ ...p, decisions: { ...p.decisions, [fieldKey(c.track_id, c.field)]: { choice, drive: c.drive, library: c.library } } }));
  const clearResults = () => { if (root) setResults((r) => { const n = { ...r }; delete n[root]; return n; }); };

  const queuePlaylist = (pl: ExternalDrivePreviewPlaylist, state: RowState) => {
    if (state.kind !== 'work') return;
    const key = `pl:${pl.id}`;
    const snapshot = snapshotOfPlaylist(pl);
    const name = (plan.names[pl.id] ?? pl.name ?? '').trim() || (pl.name ?? 'Playlist');
    if (state.action === 'copy') {
      setPlan((p) => ({ ...p, queue: [...p.queue.filter((i) => i.key !== key), { key, kind: 'copy', playlistId: pl.id, name, snapshot }] }));
    } else {
      const m = pl.membership!;
      const target = state.action === 'pair' ? m.candidate_id : m.counterpart_id;
      if (target == null || !m.target_token) return;
      setPlan((p) => ({ ...p, queue: [...p.queue.filter((i) => i.key !== key), {
        key, kind: 'update', playlistId: pl.id, name: state.action === 'pair' ? `${m.candidate_name} (paired with drive folder ${pl.folder_path})` : (pl.name ?? name), snapshot,
        counterpartId: target, token: m.target_token!,
      }] }));
    }
    clearResults();
  };
  const newTracks = preview?.entries.filter((e) => e.status === 'new') ?? [];
  const queueTrack = (entry: ExternalDrivePullEntry) => {
    if (!preview || entry.status !== 'new' || !hasDest) return;
    const key = `track:${entry.ordinal}`;
    setPlan(p => ({ ...p, queue: [...p.queue.filter(item => item.key !== key && item.key !== 'tracks'), { key, kind: 'tracks', name: entry.title ?? entry.device_path, snapshot: snapshotOfTracks({ ...preview, entries: [entry] }), ordinals: [entry.ordinal] }] }));
    clearResults();
  };
  const queueTracks = () => {
    if (!preview) return;
    setPlan((p) => ({ ...p, queue: [...p.queue.filter((i) => i.kind !== 'tracks'), {
      key: 'tracks', kind: 'tracks', name: plural(newTracks.length, 'track'), snapshot: snapshotOfTracks(preview), ordinals: newTracks.map((e) => e.ordinal),
    }] }));
    clearResults();
  };

  const apply = async () => {
    if (!drive || applying || items.length === 0) return;
    const target = drive;
    setApplying(true);
    const out: ItemResult[] = [];
    try {
      for (const item of items) {
        try {
          if (item.kind === 'fields') {
            const now = await api.externalDrives.fields(target.root);
            if (fieldsSnapshot(now, item.changes) !== item.snapshot) {
              out.push({ key: item.key, name: item.name, status: 'held', detail: 'Changed since you queued it. Nothing was done; review it again.' });
              continue;
            }
            const done = await api.externalDrives.applyFields(target.root, now.fingerprint, item.changes.map((c) => ({ track_id: c.track_id, field: c.field, drive: c.drive, library: c.library })));
            out.push({ key: item.key, name: item.name, status: 'done', detail: `Updated ${plural(done.applied.length, 'track detail')} in your library from the drive. The drive was not changed.` });
            continue;
          }
          const bound = await api.externalDrives.preview(target.root, dest || undefined, true);
          const pl = item.kind === 'tracks' ? null : (bound.playlists ?? []).find((p) => p.id === item.playlistId);
          const nowSnap = item.kind === 'tracks' ? snapshotOfTracks({ ...bound, entries: bound.entries.filter(entry => item.ordinals.includes(entry.ordinal)) }) : pl ? snapshotOfPlaylist(pl) : null;
          if (nowSnap !== item.snapshot) {
            out.push({ key: item.key, name: item.name, status: 'held', detail: 'Changed since you queued it. Nothing was done; review it again.' });
            continue;
          }
          const res = await api.externalDrives.import(
            item.kind === 'tracks'
              ? { root: target.root, destination: dest || undefined, confirm: true, preview_fingerprint: bound.fingerprint, ordinals: item.ordinals }
              : item.kind === 'copy'
                ? { root: target.root, destination: dest || undefined, confirm: true, preview_fingerprint: bound.fingerprint, create_playlist_id: item.playlistId,
                    ...(item.name && item.name !== (pl?.name ?? '') ? { playlist_name: item.name } : {}) }
                : { root: target.root, destination: dest || undefined, confirm: true, preview_fingerprint: bound.fingerprint,
                    create_playlist_id: item.playlistId, update_playlist_id: item.counterpartId, update_target_token: item.token },
          );
          out.push({ key: item.key, name: item.name, status: res.errors?.length ? 'failed' : 'done', detail: describeResult(item.kind, res) });
        } catch (e) {
          out.push({ key: item.key, name: item.name, status: 'failed', detail: e instanceof Error ? e.message : 'Failed' });
        }
      }
    } finally {
      setResults((r) => ({ ...r, [target.root]: out }));
      setPlans((prev) => ({ ...prev, [target.root]: EMPTY_PLAN }));
      setApplying(false);
      read(target);
    }
  };

  // Rows. A playlist keeps its drive order. All tracks lists what needs attention first.
  const rank = (e: ExternalDrivePullEntry) => {
    if (e.status === 'new') return 0;
    if (e.status !== 'present') return 1;
    const ft = fieldTrackByOrdinal.get(e.ordinal);
    if (ft?.fields.some((f) => f.applicable)) return 2;
    return ft ? 3 : 4;
  };
  const baseRows = selected ? (selected.track_ordinals ?? []).map((o) => byOrdinal.get(o)).filter((e): e is ExternalDrivePullEntry => !!e)
    : [...(preview?.entries ?? [])].sort((a, b) => rank(a) - rank(b) || a.ordinal - b.ordinal);
  const rows = issuesOnly ? baseRows.filter((e) => rank(e) < 4) : baseRows;
  const missingRows = selected ? selected.track_count - baseRows.length : 0;
  const incomplete = playlists.filter((p) => (p.track_ordinals ?? []).filter((o) => byOrdinal.has(o)).length < p.track_count).length;
  const sum = preview ? summarize(preview) : null;
  const selState = selected ? classifyPlaylist(selected, hasDest) : null;
  const selTag = selState ? playlistTag(selState) : null;
  const groups = [...new Set(playlists.map((p) => folderOf(p).join(' / ')))];
  const family = drive?.kind === 'rekordbox' ? 'Rekordbox' : 'Engine DJ (under construction)';
  const structure = !drive ? null : drive.kind === 'engine' ? { tone: 'none' as Tone, text: 'Engine drives: not checked' }
    : d.check === null ? { tone: 'none' as Tone, text: 'Files: checking' }
    : d.check === 'failed' ? { tone: 'unknown' as Tone, text: 'Files: not checked' }
    : d.check.checked && d.check.error_count === 0 ? { tone: 'ok' as Tone, text: `Files read back: ${plural(d.check.tracks, 'track')}, ${plural(d.check.playlists, 'playlist')}` }
    : { tone: 'unknown' as Tone, text: 'Files: not assessed' };
  const otherPlans = (drives ?? []).filter((x) => x.root !== root && ((plans[x.root]?.queue.length ?? 0) > 0 || Object.values(plans[x.root]?.decisions ?? {}).some((v) => v.choice === 'take')));
  const planCount = (r: string) => (plans[r]?.queue.length ?? 0) + (Object.values(plans[r]?.decisions ?? {}).some((v) => v.choice === 'take') ? 1 : 0);
  const res = (root && results[root]) || null;
  const issueCount = sum ? sum.notInLibraryTracks + sum.unverifiedTracks + sum.look + sum.update + incomplete + undecided : 0;

  return (
    <div className="pg-view">
      <div className="pg-top">
        <b>Sync</b>
        {drives?.map((x) => (
          <button key={x.root} className="btn" disabled={navigationLocked} aria-pressed={!desktop && x.root === root} onClick={() => { setDesktop(null); setRoot(x.root); }}>
            {x.name}{planCount(x.root) > 0 && <span className="pg-badge">{planCount(x.root)}</span>}
          </button>
        ))}
        <button className="btn pg-desktop" disabled={navigationLocked} aria-pressed={desktop === 'rekordbox'} title="The Rekordbox library on this computer" onClick={() => setDesktop('rekordbox')}>Rekordbox desktop</button>
        <button className="btn" disabled={navigationLocked} aria-pressed={desktop === 'engine'} title="The Engine DJ library on this computer, not USB" onClick={() => setDesktop('engine')}>Engine DJ desktop</button>
        <button className="btn pg-detect" disabled={applying} onClick={() => { setDrives(null); detect(); }}>Detect drives</button>
        {toolbar}
      </div>
      {desktop && <DesktopSourceBrowser key={desktop} source={desktop} onPendingChange={setDesktopBusy} />}
      {!desktop && drives === null && <p className="pg-empty" role="status">Looking for drives…</p>}
      {!desktop && detectError && <p className="pg-empty tone-unknown" role="alert">Drive detection failed ({detectError})</p>}
      {!desktop && drives && drives.length === 0 && !detectError && <p className="pg-empty">No USB found</p>}
      {!desktop && drive && (
        <div className="pg-browser" aria-label={`USB ${drive.name}`} aria-busy={d.read.state === 'loading'} style={{ '--plan-width': `${planWidth}px` } as CSSProperties}>
          <header className="pg-bar">
            <b>{drive.name}</b><span className="pg-chip">{family}</span>
            <span className="pg-read">{d.read.state === 'loading' && <span className="pg-read-spinner" aria-hidden="true" />}{d.read.state === 'ready' ? `Read ${d.read.readAt.toLocaleTimeString()}` : d.read.state === 'loading' ? 'Reading…' : 'Not read'}</span>
            <button className="btn" disabled={applying} onClick={() => read(drive)}>Recheck</button>
          </header>
          <aside className="pg-left" aria-label="Playlists">
            <button className={`pg-pl${sel === 'all' ? ' on' : ''}`} onClick={() => setSel('all')}>
              <span className="pg-dot tone-none" aria-hidden /><span className="pg-plname">All tracks</span><span className="pg-n">{preview ? preview.entries.length : ''}</span>
            </button>
            {groups.map((f) => (
              <div key={f || '·'}>
                {f && <div className="pg-folder">{f}</div>}
                {playlists.filter((p) => folderOf(p).join(' / ') === f).sort((a, b) => urgency(classifyPlaylist(a, hasDest)) - urgency(classifyPlaylist(b, hasDest))).map((p) => {
                  const st = classifyPlaylist(p, hasDest);
                  const t = playlistTag(st);
                  const q = queued(`pl:${p.id}`);
                  return (
                    <button key={p.id} className={`pg-pl${sel === p.id ? ' on' : ''}${f ? ' nested' : ''}`} title={st.label} onClick={() => setSel(p.id)}>
                      <span className={`pg-dot tone-${q ? 'queued' : t.tone}`} aria-hidden /><span className={`pg-plname${t.label === 'Not in library' ? ' missing' : ''}`}>{p.name ?? '(unnamed)'}</span>{t.label === 'Not in library' && <span className="pg-new">New</span>}<span className="pg-n">{p.track_count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {d.read.state === 'ready' && playlists.length === 0 && <p className="pg-empty">No playlists</p>}
          </aside>
          <main className="pg-main">
            {d.read.state === 'loading' && <p className="pg-empty" role="status" aria-live="polite">Reading {drive.name} USB…</p>}
            {d.read.state === 'error' && <p className="pg-empty tone-unknown" role="alert">Could not read this drive ({d.read.message}). Unplugged?</p>}
            {preview && (
              <>
                <div className="pg-title" role="toolbar" aria-label="Sync track actions">
                  <b>{selected ? fullName(selected) : 'All tracks'}</b>
                  {selectedOrdinals.size > 0 ? (
                    <div className="pg-selected-actions" role="status"><b>{selectedOrdinals.size} selected</b><span>{rows.filter(e => selectedOrdinals.has(e.ordinal) && e.status === 'new').length} importable · {rows.filter(e => selectedOrdinals.has(e.ordinal) && e.status !== 'new').length} excluded</span><button className="btn" disabled={applying || !hasDest || !rows.some(e => selectedOrdinals.has(e.ordinal) && e.status === 'new')} onClick={() => rows.filter(e => selectedOrdinals.has(e.ordinal) && e.status === 'new').forEach(queueTrack)}>Plan imports</button><button className="btn" disabled={applying} onClick={() => setSelectedOrdinals(new Set())}>Clear selection</button></div>
                  ) : <>
                  <span>{plural(rows.length, 'track')}{missingRows > 0 ? ` of ${selected!.track_count}` : ''}</span>
                  {selTag && <span className={`pg-tag tone-${selTag.tone}`} title={selState!.label}>{selTag.label}</span>}
                  <span className="pg-order">{selected ? 'Drive order' : 'Needs attention first'}</span>
                  <button className="btn pg-filter" aria-pressed={issuesOnly} onClick={() => setIssuesOnly((v) => !v)}>Issues only</button>
                  <div className="pg-playlist-actions" aria-label="Whole-playlist actions">
                  {selected && selState!.kind === 'work' && (queued(`pl:${selected.id}`)
                    ? <button className="btn" onClick={() => dequeue(`pl:${selected.id}`)}>Remove from plan</button>
                    : <button className="btn" title={`Whole playlist: ${fullName(selected)}. Adds a reviewable operation, does not apply it.`} disabled={applying || plan.queue.some(item => item.kind === 'tracks')} onClick={() => queuePlaylist(selected, selState!)}>
                        {selState!.action === 'copy' ? 'Plan whole playlist' : selState!.action === 'pair' ? `Pair whole playlist` : 'Plan playlist update'}
                      </button>)}
                  {!selected && newTracks.length > 0 && (queued('tracks')
                    ? <button className="btn" onClick={() => dequeue('tracks')}>Remove from plan</button>
                    : <button className="btn" disabled={applying || !hasDest} onClick={queueTracks}>Plan all {newTracks.length} imports</button>)}
                  </div>
                  </>}
                </div>
                {selected && selState!.kind === 'work' && selState!.action === 'copy' && !queued(`pl:${selected.id}`) && (
                  <label className="pg-name-edit">Library name
                    <input type="text" value={plan.names[selected.id] ?? selected.name ?? ''} onChange={(e) => setPlan((p) => ({ ...p, names: { ...p.names, [selected.id]: e.target.value } }))} />
                  </label>
                )}

                <table className="pg-tracks" ref={fit.tableRef} style={fit.variables}>
                  <thead>{fit.headers(['#', 'Title', 'Artist', 'BPM', 'Key', 'Library preview', 'Library', d.fields === 'failed' ? 'Differs: unknown' : 'Differs'])}</thead>
                  <tbody>
                    {rows.map((e, i) => {
                      const m = trackMarker(e);
                      const keyValue = KEY_TABLE.find(row => row.camelot === e.key || row.openkey === e.key)?.engineId ?? e.key;
                      const ft = fieldTrackByOrdinal.get(e.ordinal);
                      const titleDiffers = ft?.fields.some(f => f.field === 'title' && f.drive !== f.library) ?? false;
                      const diffKey = `${root}:${e.ordinal}`;
                      const expanded = expandedDiffs.has(diffKey);
                      return [
                        <tr key={`${e.ordinal}:${i}`} className={`track-row pg-track-row row-${m.tone}${selectedOrdinals.has(e.ordinal) ? ' track-row-selected' : ''}`} onClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,summary,a')) toggleDiff(diffKey); }}>
                          <td className="pg-i"><input type="checkbox" aria-label={`Select ${e.title ?? e.device_path}`} checked={selectedOrdinals.has(e.ordinal)} disabled={applying} onChange={() => setSelectedOrdinals(previous => { const next = new Set(previous); if (next.has(e.ordinal)) next.delete(e.ordinal); else next.add(e.ordinal); return next; })} /><span className="pg-row-number">{i + 1}</span></td>
                          <td><div className="pg-track-title"><button type="button" className="pg-row-disclosure" aria-label={`Details for ${e.title ?? e.device_path}`} aria-expanded={expanded} onClick={() => toggleDiff(diffKey)}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span></button><span className="pg-title-text" title={e.title ?? e.device_path}>{e.title ?? e.device_path}</span>{titleDiffers && <span className="pg-title-divergence" title="Title differs between USB and Library. Newer source unknown."><DivergenceIcon label="Title differs; newer source unknown" /></span>}</div></td>
                          <td><span className="pg-artist-compact" title={e.artist ?? ''}>{e.artist ?? ''}</span></td>
                          <td><BPMDisplay bpm={e.bpm == null ? null : Math.round(e.bpm * 10) / 10} round={false} /></td><td><span title={e.key ?? undefined}>{formatKeyDisplay(keyValue) === '-' ? e.key ?? '—' : <KeyDisplay keyValue={keyValue} />}</span></td>
                          <td className="pg-preview-cell">{e.status === 'present' && e.matched_track_id != null ? <span title="Library waveform for the confirmed audio match. Not USB cues."><TrackWaveformPreview trackId={e.matched_track_id} duration={e.duration_secs} /></span> : <span className="pg-preview-unavailable" title="No confirmed Library audio match, so no Library waveform can be shown">—</span>}</td>
                          <td><div className="pg-row-actions"><span className={`pg-tag tone-${m.tone}`} title={`${m.label}: ${m.hint}`} aria-label={m.label}>{e.status === 'new' ? 'New' : e.status === 'present' ? 'In library' : e.status === 'missing-file' ? 'Missing' : e.status === 'duplicate' ? 'Duplicate' : 'Unverified'}</span>{e.status === 'new' && (queued(`track:${e.ordinal}`) ? <button className="btn pg-row-action" aria-label={`Remove ${e.title ?? e.device_path} from plan`} disabled={applying} onClick={() => dequeue(`track:${e.ordinal}`)}>Undo</button> : <button className="btn pg-row-action" aria-label={`Plan import ${e.title ?? e.device_path}`} disabled={applying || !hasDest || plan.queue.some(item => item.kind !== 'fields' && item.kind !== 'tracks') || queued('tracks')} onClick={() => queueTrack(e)}>Import</button>)}</div></td>
                          <td>{ft?.fields.length ? <button type="button" className="pg-diff-toggle" aria-label={`Differences for ${e.title ?? e.device_path}`} title={ft.fields.map(f => `${FIELD_LABEL[f.field] ?? f.field}${f.conflict ? ': ' + f.conflict : ''}`).join(' · ')} aria-expanded={expanded} onClick={() => toggleDiff(diffKey)}>
                            <span className={`pg-tag tone-${ft.fields.some(f => f.applicable) ? 'work' : 'unknown'}`}>{ft.fields.length === 1 ? FIELD_LABEL[ft.fields[0].field] ?? ft.fields[0].field : `${ft.fields.length} fields`}</span>
                            <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
                          </button> : <span className="pg-comparison-state">{e.candidates?.length ? <button className="btn pg-diff-toggle" title="Possible copies, not confirmed audio matches" onClick={() => toggleDiff(diffKey)} aria-expanded={expanded}>{e.candidates.length} {e.candidates.length === 1 ? 'copy?' : 'copies?'}</button> : e.status !== 'present' ? 'Match needed' : d.fields === 'failed' ? 'Unavailable' : d.fields === null ? 'Checking…' : '—'}</span>}</td>
                        </tr>,
                        ...(expanded ? [<tr className="pg-context" key={`context:${e.ordinal}`}><td /><td colSpan={7}><div className="pg-context-head"><span className={`pg-tag tone-${e.status === 'present' ? 'ok' : 'unknown'}`}>{e.status === 'present' ? 'Exact audio' : 'Audio unverified'}</span><span className="pg-chip">USB → Library</span></div>{e.candidates?.map(candidate => <div key={candidate.track_id} className="pg-candidate"><b>{candidate.title ?? candidate.filename}</b><span>{candidate.artist} <span className="pg-tag tone-unknown">Possible copy</span> <span className="pg-tag">{candidate.duration} duration</span></span><details className="pg-exact"><summary>Evidence</summary><span>{candidate.evidence}</span><span>{candidate.filename}</span></details></div>)}<div className="pg-track-facts"><span title={e.title ?? e.device_path}>{e.title ?? e.device_path}</span><span>{e.artist}</span><span>USB: {e.device_path}</span><span>Library: {e.matched_path ?? 'No confirmed audio match'}</span></div>{e.status !== 'present' && <ConstructionNotice label="Link copy / cue source" detail="Persistent cross-copy links and cue provenance choices are not wired yet. No link or write is selected." />}</td></tr>] : []),
                        ...(ft && expanded ? ft.fields.map((f) => {
                          const c: FieldChoice = { track_id: ft.track_id, field: f.field, label: ft.label, drive: f.drive, library: f.library };
                          const dec = decisionFor(c);
                          return (
                            <tr key={`${e.ordinal}:${i}:${f.field}`} className="pg-diff">
                              <td /><td colSpan={4}><span className="pg-fname">{FIELD_LABEL[f.field] ?? f.field}</span>{hoverResult?.key === fieldKey(c.track_id, c.field) ? <span className="pg-result-preview"><span className="pg-chip">Library result</span> {hoverResult.value ?? 'empty'}</span> : <><span className="pg-mine">Library</span> {f.library ?? 'empty'} <span className="pg-arrow">·</span> <span className="pg-mine">USB</span> {String(f.drive)}</>}</td>
                              <td colSpan={3}>{f.applicable ? <>
                                <span className="pg-field-target">USB → Library</span>
                                <button className={`btn${dec?.choice === 'keep' ? ' btn-primary' : ''}`} disabled={applying} aria-pressed={dec?.choice === 'keep'} onMouseEnter={() => setHoverResult({ key: fieldKey(c.track_id, c.field), value: f.library })} onMouseLeave={() => setHoverResult(null)} onFocus={() => setHoverResult({ key: fieldKey(c.track_id, c.field), value: f.library })} onBlur={() => setHoverResult(null)} onClick={() => decide(c, 'keep')}>Keep Library</button>
                                <button className={`btn${dec?.choice === 'take' ? ' btn-primary' : ''}`} disabled={applying} aria-pressed={dec?.choice === 'take'} onMouseEnter={() => setHoverResult({ key: fieldKey(c.track_id, c.field), value: f.drive })} onMouseLeave={() => setHoverResult(null)} onFocus={() => setHoverResult({ key: fieldKey(c.track_id, c.field), value: f.drive })} onBlur={() => setHoverResult(null)} onClick={() => decide(c, 'take')}>{dec?.choice === 'take' ? 'Planned ✓' : 'Use USB'}</button>
                                {dec && selected && similarChoices(c).length > 0 && <button className="btn pg-link" disabled={applying} onClick={() => setSimilarReview({ seedTrackId: c.track_id, field: c.field, choice: dec.choice, changes: similarChoices(c) })}>Apply to similar…</button>}
                                {dec?.choice === 'take' && <button className="btn" disabled={applying} onClick={() => setPlan(p => ({ ...p, decisions: Object.fromEntries(Object.entries(p.decisions).filter(([key]) => key !== fieldKey(c.track_id, c.field))) }))}>Undo</button>}
                                </> : <span className="pg-comparison-state">{f.conflict ?? (f.field === 'bpm' ? 'Read only · analysis' : 'Read only · cannot apply this field')}</span>}
                              </td>
                            </tr>
                          );
                        }) : []),
                        ...(ft && expanded && similarReview?.seedTrackId === ft.track_id ? [<tr key={`similar:${e.ordinal}`} className="pg-context pg-similar-context"><td /><td colSpan={7}><section ref={similarPanel} className="pg-similar-review" role="region" aria-label="Review similar choices">
                  <div className="pg-context-head"><b>{similarReview.choice === 'take' ? 'Use USB' : 'Keep Library'} · {FIELD_LABEL[similarReview.field] ?? similarReview.field}</b><span className="pg-tag">{plural(similarReview.changes.length, 'additional track')}</span></div>
                  <p>In {selected?.name}. Exact audio only. Existing choices, other fields and unverified copies stay untouched.</p>
                  <ul>{similarReview.changes.map(c => <li key={c.track_id}><b>{c.label}</b><span>Library: {c.library ?? 'empty'}</span><span>USB: {c.drive ?? 'empty'}</span><span className="pg-plan-new">{similarReview.choice === 'take' ? 'Plan Library value' : 'Keep Library value'}: {similarReview.choice === 'take' ? c.drive : c.library}</span></li>)}</ul>
                  <div className="pg-context-head"><button className="btn btn-primary" disabled={applying} onClick={stageSimilar}>{similarReview.choice === 'take' ? 'Add these choices to plan' : 'Keep Library for these tracks'}</button><button className="btn" onClick={() => setSimilarReview(null)}>Cancel</button><span>No files change here. USB unchanged.</span></div>
                </section></td></tr>] : []),
                      ];
                    })}
                  </tbody>
                </table>

                {rows.length === 0 && <p className="pg-empty">{issuesOnly ? 'No issues' : 'No tracks'}</p>}
              </>
            )}
          </main>
          <aside ref={planSidebar} className="pg-right" aria-label="Plan and warnings"><span className="pg-plan-grip" role="separator" tabIndex={0} aria-label="Resize plan sidebar" aria-orientation="vertical" aria-valuenow={Math.round(planWidth)} onPointerDown={resizePlan} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setPlanWidth(width => Math.max(240, Math.min(520, width + (event.key === 'ArrowLeft' ? 20 : -20)))); } }} />
            <h3>Plan{items.length ? ` (${plural(items.length, 'operation')})` : ''}</h3>
            <div className="pg-target-chips"><span className="pg-chip">USB → Library</span><span className="pg-tag tone-none">USB read-only</span></div>
            <ul className="pg-list">
              {items.map((q) => (
                <li key={q.key} className="tone-work">
                  <b>{q.kind === 'copy' ? `Copy "${q.name}"` : q.kind === 'update' ? `Update "${q.name}"` : q.kind === 'fields' ? '' : `Import ${q.name}`}</b>
                  {q.kind === 'fields'
                    ? <div className="pg-plan-tracks"><p className="pg-plan-scope">{fieldScope}</p>{[...new Set(q.changes.map(change => change.track_id))].map(trackId => {
                        const changes = q.changes.filter(change => change.track_id === trackId);
                        return <section key={trackId} className="pg-plan-track"><h4>{changes[0].label}</h4>{changes.map(c => <div className="pg-plan-change" key={c.field}><b>{FIELD_LABEL[c.field] ?? c.field}</b><span className="pg-plan-old">{c.library ?? 'empty'}</span><span className="pg-plan-new">→ {String(c.drive)}</span><button className="btn pg-link" disabled={applying} aria-label={`Remove ${c.field} change for ${c.label}`} onClick={() => decide(c, 'keep')}>Remove this field</button></div>)}</section>;
                      })}</div>
                    : <details className="pg-exact"><summary>Details</summary>
                        <span>{q.kind === 'tracks' ? `${q.ordinals.length} explicitly selected audio file(s). Destination: ${dest}` : (() => { const pl = playlists.find((p) => p.id === (q as { playlistId: number }).playlistId); return pl ? describeChange(pl) : ''; })()}</span>
                      </details>}
                  <button className="btn pg-link" disabled={applying} onClick={() => dequeue(q.key)}>Remove</button>
                </li>
              ))}
              {items.length === 0 && !res && <li className="tone-none"><span>Nothing chosen</span></li>}

            </ul>
            {items.length > 0 && <button className="btn btn-primary pg-apply" disabled={applying || d.read.state === 'loading'} onClick={() => setReviewing(true)}>{applying ? 'Applying…' : `Review ${items.length} planned ${items.length === 1 ? 'operation' : 'operations'}${fieldTrackCount > 1 ? ` · ${plural(fieldTrackCount, 'track')} with metadata choices` : ''}`}</button>}
            {reviewing && <section className="pg-review-confirm" aria-label="Confirm reviewed plan"><b>{items.length} {items.length === 1 ? 'operation' : 'operations'} → Library</b>{fieldTrackCount > 0 && <p>{fieldScope}</p>}<div className="pg-target-chips"><span className="pg-tag">Rechecked before write</span><span className="pg-tag">USB unchanged</span></div><button className="btn btn-primary" disabled={applying} onClick={() => void apply()}>Confirm and apply plan</button><button className="btn" disabled={applying} onClick={() => setReviewing(false)}>Back to planning</button></section>}
            {otherPlans.map((x) => <button key={x.root} className="btn pg-link" onClick={() => setRoot(x.root)}>{planCount(x.root)} more planned on {x.name}</button>)}
            {res && (
              <div role="status">
                <h3>Result</h3>
                <ul className="pg-list">
                  {res.map((r) => <li key={r.key} className={`res-${r.status} tone-${r.status === 'done' ? 'ok' : 'unknown'}`}><b>{r.name}: {r.status}</b><span>{r.detail}</span></li>)}
                </ul>
              </div>
            )}
            <details className="pg-exact pg-more"><summary>More operations <span className="pg-tag tone-unknown">Building</span></summary><p>Apply to similar: choose one field on a track, then preview the same choice for undecided exact-audio differences in this playlist. USB title writes and mixed membership plans are not wired.</p><ConstructionNotice label="Cue / grid comparison" detail="USB cue and grid comparison is not wired. Only title, artist, key and BPM are compared." />{drive.kind === 'rekordbox' && <ul className="pg-list"><ExportImpact root={drive.root} /></ul>}</details>
            <details className="pg-exact pg-more"><summary>Warnings</summary>
            <ul className="pg-list">
              {d.read.state === 'error' && <li className="tone-unknown">Drive not read</li>}
              {sum && sum.notInLibraryTracks > 0 && <li className="tone-work">{plural(sum.notInLibraryTracks, 'track')} not in library</li>}
              {sum && sum.unverifiedTracks > 0 && <li className="tone-unknown">{plural(sum.unverifiedTracks, 'track')} unverified</li>}
              {sum && sum.look > 0 && <li className="tone-unknown">{plural(sum.look, 'playlist')} need a look</li>}
              {sum && sum.update > 0 && <li className="tone-work">{plural(sum.update, 'playlist')} differ from library</li>}
              {undecided > 0 && <li className="tone-work">{plural(undecided, 'detail')} to decide</li>}
              {changedChoices > 0 && <li className="tone-unknown">{plural(changedChoices, 'choice')} changed since you made them</li>}
              {d.fields === 'failed' && <li className="tone-unknown">Detail differences unknown</li>}
              {incomplete > 0 && <li className="tone-unknown">{plural(incomplete, 'playlist')} list incomplete</li>}
              {sum && issueCount === 0 && changedChoices === 0 && d.fields !== 'failed' && d.fields !== null && <li className="tone-none">None found</li>}
            </ul>
            </details>
            <details className="pg-exact pg-checked"><summary>What was checked</summary>
            <ul className="pg-list">
              {structure && <li className={`tone-${structure.tone}`}>{structure.text}</li>}
              {sum && <li className={`tone-${sum.match === sum.playlists && sum.playlists > 0 ? 'ok' : 'none'}`}>{sum.match} of {plural(sum.playlists, 'playlist')} match by audio</li>}
              <li className="tone-unknown">Not checked: cues, beatgrids, player load</li>
            </ul></details>
          </aside>
        </div>
      )}
    </div>
  );
}
