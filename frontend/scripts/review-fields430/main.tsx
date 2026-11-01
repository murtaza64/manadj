import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from '../../src/api/client';
import { FieldReviewEntry } from '../../src/components/FieldReviewInspector';
import { UnifiedTracksSync } from '../../src/components/UnifiedTracksSync';
import { installTheme } from '../../src/theme/tokens';
import type { Track } from '../../src/types';
import '../../src/styles/base.css';
import '../../src/styles/utilities.css';

installTheme();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function App() {
  const [context, setContext] = useState('library');
  const [selected, setSelected] = useState([1, 2]);
  const [filter, setFilter] = useState(true);
  const { data } = useQuery({ queryKey: ['tracks'], queryFn: () => api.tracks.list() });
  const tracks: Track[] = data?.items || [];
  const visible = filter ? tracks.slice(0, 4) : tracks;
  return <main style={{ padding: 16, height: '100vh', overflow: 'auto', background: 'var(--base)', color: 'var(--text)' }}>
    <p style={{ color: 'var(--yellow)' }}>SYNTHETIC SANDBOX · real production inspector/API and Library persistence in memory · external adapters simulated · no installed DB/media/device writes</p>
    <nav><button className="btn" onClick={() => setContext('library')}>Library scope harness</button><button className="btn" onClick={() => setContext('tracks')}>Actual Tracks inbox</button></nav>
    <p>Production entry wiring also exists in Library.tsx; this table is a scope harness, not a second Library implementation. <a href="/source.json">Source pin</a></p>
    {context === 'tracks' ? <UnifiedTracksSync /> : <><h1>Library · fields only</h1><label><input type="checkbox" checked={filter} onChange={() => setFilter(!filter)} />First four tracks filter</label>
      <FieldReviewEntry scopes={{ selected: async () => selected, filtered: async () => visible.map(track => track.id), all: async () => tracks.map(track => track.id) }} />
      <table><thead><tr><th>Select</th><th>ID</th><th>Track</th><th>Library key</th></tr></thead><tbody>{visible.map(track => <tr key={track.id}><td><input aria-label={`Select track ${track.id}`} type="checkbox" checked={selected.includes(track.id)} onChange={() => setSelected(selected.includes(track.id) ? selected.filter(id => id !== track.id) : [...selected, track.id])} /></td><td>{track.id}</td><td>{track.title}</td><td>{track.key ?? 'Empty'}</td></tr>)}</tbody></table>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
