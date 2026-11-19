import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PlaylistCoverage } from '../types';
import { PlaylistExportInspector } from './PlaylistExportInspector';
import { plural } from './plural';

/** Rekordbox desktop as a source, read only. It is a library on this computer, not a removable drive.
 * Nothing here writes. Export opens the existing reviewed, token-bound export. Lists are compared by
 * file path only: no audio, cue, beatgrid or tag check, so nothing here is ever "synced". */

type Tone = 'ok' | 'work' | 'unknown' | 'none';
type Row = {
  name: string; path: string[];
  mine: string[] | null; desk: string[] | null; // null: playlist absent in that library
  ambiguous: boolean;
};
/** canReviewExport is false whenever identity is unresolved. Export entry depends on this flag, never on copy. */
export type DesktopMarker = { tone: Tone; label: string; hint: string; canReviewExport: boolean };

// Slash style only. Letter case is never folded: whether a volume is case-insensitive is not known here.
const norm = (f: string) => f.replaceAll('\\', '/');
const fold = (f: string) => norm(f).toLowerCase();

export function buildRows(c: PlaylistCoverage): Row[] {
  return c.playlists.map((p) => {
    const m = p.entries.manadj, r = p.entries.rekordbox;
    return {
      name: p.name, path: p.path,
      mine: m.length ? m[0].tracks.map((t) => t.filename) : null,
      desk: r.length ? r[0].tracks.map((t) => t.filename) : null,
      ambiguous: m.length > 1 || r.length > 1,
    };
  });
}

export function diffLists(mine: string[], desk: string[]) {
  const a = new Set(mine.map(norm)), b = new Set(desk.map(norm));
  const onlyMine = mine.filter((f) => !b.has(norm(f)));
  const onlyDesk = desk.filter((f) => !a.has(norm(f)));
  const sameSet = onlyMine.length === 0 && onlyDesk.length === 0;
  // Paths that differ only by letter case may or may not be one file. Never decided here.
  const fm = new Set(mine.map(fold)), fd = new Set(desk.map(fold));
  // Two different exact paths in one list that fold together also leave identity unresolved.
  const collides = (l: string[]) => new Set(l.map(norm)).size !== new Set(l.map(fold)).size;
  const caseOnly = (!sameSet && [...fm].every((f) => fd.has(f)) && [...fd].every((f) => fm.has(f))) || collides(mine) || collides(desk);
  const sameOrder = sameSet && mine.length === desk.length && mine.every((f, i) => norm(f) === norm(desk[i]));
  return { onlyMine, onlyDesk, sameSet, sameOrder, caseOnly };
}

export function markerFor(r: Row, deskRead: boolean): DesktopMarker {
  if (!deskRead) return { tone: 'unknown', label: 'Unknown', hint: 'Rekordbox desktop was not read', canReviewExport: false };
  if (r.ambiguous) return { tone: 'unknown', label: 'Unclear', hint: 'More than one playlist has this name in a library', canReviewExport: false };
  if (!r.desk) return { tone: 'work', label: 'Not in Rekordbox', hint: 'In manaDJ only', canReviewExport: true };
  if (!r.mine) return { tone: 'none', label: 'Only in Rekordbox', hint: 'Not in manaDJ', canReviewExport: false };
  const d = diffLists(r.mine, r.desk);
  if (d.caseOnly) return { tone: 'unknown', label: 'Unclear', hint: 'File paths differ only by letter case. Not decided whether they are the same files', canReviewExport: false };
  if (!d.sameSet) return { tone: 'work', label: 'Tracks differ', hint: `${plural(d.onlyMine.length, 'track')} only in manaDJ, ${plural(d.onlyDesk.length, 'track')} only in Rekordbox, by file path`, canReviewExport: true };
  if (!d.sameOrder) return { tone: 'work', label: 'Order differs', hint: 'Same file paths, different order', canReviewExport: true };
  return { tone: 'none', label: 'Same paths', hint: 'Same file paths in the same order. Audio, cues, beatgrids and tags are not compared', canReviewExport: true };
}

const base = (p: string) => p.replaceAll('\\', '/').split('/').pop() || p;

export function DesktopLibrary() {
  const [cov, setCov] = useState<PlaylistCoverage | 'failed' | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const load = useCallback(() => {
    setCov(null);
    api.playlistSync.getCoverage().then(setCov).catch(() => setCov('failed'));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (cov === null) return <p className="pg-empty" role="status">Reading Rekordbox desktop…</p>;
  if (cov === 'failed') return <p className="pg-empty tone-unknown" role="alert">Could not read libraries. <button className="btn pg-link" onClick={load}>Retry</button></p>;
  const src = cov.sources.rekordbox;
  if (src.status === 'not_configured') {
    return <p className="pg-empty" role="status">Rekordbox desktop is not set up. Add its library folder in Settings. Nothing was read. <button className="btn pg-link" onClick={load}>Recheck</button></p>;
  }
  if (src.status === 'failed') {
    return <p className="pg-empty tone-unknown" role="alert">Rekordbox desktop could not be read ({src.reason ?? 'unknown'}). Nothing is known about its playlists, so none are shown as missing. <button className="btn pg-link" onClick={load}>Retry</button></p>;
  }
  const rows = buildRows(cov).filter((r) => r.mine || r.desk);
  const sorted0 = rows;
  const rank = (r: Row) => { const m = markerFor(r, true); return m.label === 'Not in Rekordbox' ? 0 : m.tone === 'work' ? 1 : m.tone === 'unknown' ? 2 : 3; };
  const unclear = sorted0.filter((r) => rank(r) === 2).length;
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
  const selected = sorted.find((r) => r.name === sel) ?? null;
  const needs = sorted.filter((r) => rank(r) < 2).length;
  const detail = selected && !selected.ambiguous && selected.mine && selected.desk ? diffLists(selected.mine, selected.desk) : null;
  const sm = selected ? markerFor(selected, true) : null;
  return (
    <div className="pg-browser" aria-label="Rekordbox desktop">
      <header className="pg-bar">
        <b>Rekordbox desktop</b><span className="pg-chip">This computer</span>
        <span className="pg-read">Read {new Date(src.read_at).toLocaleTimeString()}</span>
        <button className="btn" onClick={load}>Recheck</button>
      </header>
      <aside className="pg-left" aria-label="Playlists">
        {sorted.map((r) => {
          const m = markerFor(r, true);
          return (
            <button key={r.name} className={`pg-pl${sel === r.name ? ' on' : ''}`} onClick={() => setSel(r.name)} title={m.hint}>
              <span className={`pg-dot tone-${m.tone}`} aria-hidden /><span className="pg-plname">{r.name}</span><span className="pg-n">{m.label}</span>
            </button>
          );
        })}
        {sorted.length === 0 && <p className="pg-empty">No playlists</p>}
      </aside>
      <main className="pg-main">
        {!selected && <p className="pg-empty">{needs + unclear > 0 ? `${plural(needs + unclear, 'playlist')} need attention. Pick one.` : 'Pick a playlist'}</p>}
        {selected && sm && selected.ambiguous && (
          <>
            <div className="pg-title"><b>{selected.name}</b><span className="pg-tag tone-unknown" title={sm.hint}>{sm.label}</span></div>
            <p className="pg-empty">This name is used by more than one playlist in a library. Not compared and not exportable from here until it is one playlist.</p>
          </>
        )}
        {selected && sm && !selected.ambiguous && (
          <>
            <div className="pg-title"><b>{selected.name}</b><span>{plural((selected.mine ?? selected.desk ?? []).length, 'track')}</span><span className={`pg-tag tone-${sm.tone}`} title={sm.hint}>{sm.label}</span></div>
            <table className="pg-tracks"><thead><tr><th /><th>File</th><th>manaDJ</th><th>Rekordbox</th></tr></thead><tbody>
              {[...new Set([...(selected.mine ?? []), ...(selected.desk ?? [])].map(norm))].map((k, i) => {
                const inM = selected.mine?.some((f) => norm(f) === k), inD = selected.desk?.some((f) => norm(f) === k);
                const name = [...(selected.mine ?? []), ...(selected.desk ?? [])].find((f) => norm(f) === k) ?? k;
                return <tr key={k} className={inM && inD ? '' : 'row-work'}><td className="pg-i">{i + 1}</td><td title={name}>{base(name)}</td><td>{inM ? 'In list' : selected.mine ? 'Not in list' : ''}</td><td>{inD ? 'In list' : selected.desk ? 'Not in list' : ''}</td></tr>;
              })}
            </tbody></table>
          </>
        )}
      </main>
      <aside className="pg-right" aria-label="Plan and warnings">
        <h3>Plan</h3>
        <ul className="pg-list">
          <li className="tone-none"><span>Nothing chosen. Desktop to manaDJ is the Rekordbox import tool.</span></li>
          {selected?.mine && !selected.ambiguous && markerFor(selected, true).canReviewExport && (
            <li className="tone-building"><b>manaDJ to Rekordbox</b>
              <span>Opens the existing export review. Rekordbox must be closed.</span>
              <button className="btn" onClick={() => setReview(selected.name)}>Review export</button>
            </li>
          )}
        </ul>
        <h3>Warnings</h3>
        <ul className="pg-list">
          {needs > 0 && <li className="tone-work">{plural(needs, 'playlist')} differ or are missing in Rekordbox</li>}
          {unclear > 0 && <li className="tone-unknown">{plural(unclear, 'playlist')} unclear, not compared</li>}
          {detail && !detail.sameSet && <li className="tone-work">{plural(detail.onlyMine.length, 'track')} only in manaDJ, {plural(detail.onlyDesk.length, 'track')} only in Rekordbox</li>}
          {needs === 0 && unclear === 0 && <li className="tone-none">None found</li>}
        </ul>
        <details className="pg-exact"><summary>What was checked</summary>
          <ul className="pg-list">
            <li className="tone-none">Playlists compared by file path and order</li>
            <li className="tone-unknown">Not checked: audio, cues, beatgrids, tags, Rekordbox write access</li>
          </ul>
        </details>
      </aside>
      {review && <PlaylistExportInspector playlistName={review} initialTarget="rekordbox" onClose={() => setReview(null)} />}
    </div>
  );
}
