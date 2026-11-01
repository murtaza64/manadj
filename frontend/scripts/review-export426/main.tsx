// Review harness: actual production entry/inspector + new backend API; all
// destination observations/writes are fixture seams. Not a production route.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { installTheme } from '../../src/theme/tokens';
import { formatKeyDisplay } from '../../src/utils/keyUtils';
import { PlaylistExportEntry } from '../../src/components/PlaylistExportInspector';
import { PlaylistDetailView } from '../../src/components/PlaylistDetailView';
import type { UnifiedPlaylist } from '../../src/types';
import '../../src/styles/base.css';
import '../../src/styles/utilities.css';
import '../../src/components/TopBar.css';
import './review.css';

installTheme();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const titles = ['Eyes Cut Deeper', 'Afterimage', 'Pressure Drop', 'Night Shift', 'Last Train', 'Daybreak'];
const entries = titles.map((title, i) => ({ track_id: i + 1, filename: `/fixture/${title}.flac` }));
const playlist = { name: 'Night Shift', manadj: entries, engine: entries, rekordbox: entries, synced: false } as UnifiedPlaylist;
function App() {
  const [context, setContext] = useState('Library');
  const [scenario, setScenario] = useState('skips');
  const [epoch, setEpoch] = useState(0);
  async function change(next: string) {
    await fetch(`/fixture/scenario?name=${encodeURIComponent(next)}`, { method: 'POST' });
    client.clear(); setScenario(next); setEpoch(v => v + 1);
  }
  return <div className="app-shell review426">
    <div className="review426-banner">FIXTURE REVIEW #426 · actual production components/API · all external observations and writes simulated · no real Library/device access</div>
    <header className="topbar"><nav className="topbar-mode-control"><button className="topbar-segment" disabled>▸ PERFORM</button><button className="topbar-segment" disabled>⋈ EDIT</button><button className="topbar-segment active" disabled>⇄ SYNC</button><button className="topbar-segment" disabled>⚙ SETTINGS</button></nav><span className="topbar-status">Source candidate, not installed app</span></header>
    <div className="review426-controls"><label>Context <select value={context} aria-label="Review context" onChange={e => setContext(e.target.value)}><option>Library</option><option>Sync playlist</option></select></label><label>Fixture <select value={scenario} aria-label="Review scenario" onChange={e => void change(e.target.value)}>{Object.entries({ skips: 'Clears / reorder / skipped field', partial: 'Per-field native write failure', blocked: 'Missing downstream record (blocked)', unavailable: 'Destination unavailable', stale: 'Destination changes after preview', unknown: 'Incomplete server receipt / unknown outcome', slow: 'Slow synchronous writer (5s)', gated: 'External export off' }).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label><button className="btn" onClick={() => void change(scenario)}>Reset fixture</button><a href="/review-notes">Scope & audit notes</a><a href="http://192.168.1.235:5424/?variant=B">Original #423 comparison</a></div>
    <main className="review426-body" key={epoch}>
      {context === 'Library' ? <div className="review426-library"><aside><h3>PLAYLISTS</h3><p className="review426-selected">Night Shift</p><p>Warm Up</p><p>After Hours</p></aside><section><header><div><h2>Night Shift</h2><p>6 tracks · play order · fixture host</p></div><PlaylistExportEntry playlistName="Night Shift" /></header><table><thead><tr><th>#</th><th>Title</th><th>Artist</th><th>BPM</th><th>Key</th></tr></thead><tbody>{titles.map((title, i) => <tr key={title}><td>{i + 1}</td><td>{title}</td><td>Fixture Artist</td><td>174</td><td>{formatKeyDisplay(8)}</td></tr>)}</tbody></table><p className="review426-note">This frozen-density host delegates to the same production PlaylistExportEntry used by Library.tsx. “Sync playlist” mounts the actual PlaylistDetailView. No copied inspector markup.</p></section></div> : <PlaylistDetailView playlist={playlist} onBack={() => setContext('Library')} />}
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
