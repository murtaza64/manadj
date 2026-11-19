import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ExternalDriveExportImpact } from '../api/client';
import { plural } from './plural';

/** Library to drive, preview only. Exporting is a rebuild of the drive's library index,
 * never an update, and it is not available yet. This shows what it would do and writes nothing. */
export function ExportImpact({ root }: { root: string }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<{ id: number; name: string }[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [impact, setImpact] = useState<ExternalDriveExportImpact | 'failed' | null>(null);
  useEffect(() => { setPicked([]); setImpact(null); }, [root]);
  useEffect(() => {
    if (!open || lists) return;
    api.playlists.list().then((l: { id: number; name: string }[]) => setLists(l)).catch(() => setLists([]));
  }, [open, lists]);
  useEffect(() => {
    if (picked.length === 0) { setImpact(null); return; }
    let live = true;
    setImpact(null);
    api.externalDrives.exportImpact(root, picked).then((i) => { if (live) setImpact(i); }).catch(() => { if (live) setImpact('failed'); });
    return () => { live = false; };
  }, [root, picked]);
  return (
    <li className="tone-building pg-export">
      <b>Library to drive</b>
      <span>Not available yet</span>
      <button className="btn pg-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide preview' : 'Preview a rebuild'}</button>
      {open && (
        <div className="pg-export-body">
          <div className="pg-export-pick">
            {(lists ?? []).map((p) => (
              <label key={p.id}><input type="checkbox" checked={picked.includes(p.id)} onChange={() => setPicked((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))} /> {p.name}</label>
            ))}
            {lists && lists.length === 0 && <span>No playlists</span>}
          </div>
          {impact === 'failed' && <span className="tone-unknown">Preview unavailable</span>}
          {impact && impact !== 'failed' && (
            <ul className="pg-export-facts">
              <li><b>Rebuilds the drive library</b> from {plural(impact.selected.length, 'playlist')}, {plural(impact.selected.reduce((n, s) => n + s.tracks, 0), 'track')}</li>
              {impact.drive.read
                ? <li>{impact.drive.dropped_playlists.length > 0 ? `Leaves the index (matched by name only): ${impact.drive.dropped_playlists.join(', ')}` : 'No drive playlist name leaves the index. Same names may still be different playlists'}</li>
                : <li className="tone-unknown">Drive library not read. What leaves the index is unknown</li>}
              {impact.drive.read && <li className="tone-unknown">A drive playlist with a kept name is still rebuilt from your selection. Its tracks and order are replaced</li>}
              {impact.selected.some((s) => s.missing_audio > 0) && <li className="tone-unknown">{plural(impact.selected.reduce((n, s) => n + s.missing_audio, 0), 'track')} skipped, audio missing</li>}
              {impact.one_library_present && <li className="tone-unknown">Newer library format on drive. Would refuse</li>}
              <li>No audio deleted</li>
              <li className="tone-unknown">Drive index and analysis files are replaced. Anything kept only on the drive (cues, ratings, history) is not carried over</li>
              <li className="tone-unknown">{impact.gate_enabled ? 'Export setting on' : 'Export setting off'}. Hardware unverified. Not enabled</li>
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
