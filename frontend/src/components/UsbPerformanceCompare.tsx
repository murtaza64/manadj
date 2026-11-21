import { useState } from 'react';
import { api, type ExternalDrivePerformanceComparison, type PerformanceCue } from '../api/client';
import { PerfDiffViewer, type PerfDiffSides } from './PerfDiffViewer';

const timestamp = (n: number) => `${n.toFixed(3)}s`;
const cueName = (c: PerformanceCue) => c.kind === 'hot' ? `Hot ${c.slot}` : c.kind === 'memory' ? 'Memory' : 'Main';

/** One row, one explicit read. No polling and no cue/grid write path. */
export function UsbPerformanceCompare({ root, ordinal, fingerprint }: { root: string; ordinal: number; fingerprint: string }) {
  const [data, setData] = useState<ExternalDrivePerformanceComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const read = async () => {
    setLoading(true); setError('');
    try { setData(await api.externalDrives.performance(root, ordinal, fingerprint)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Cue/grid comparison unavailable'); }
    finally { setLoading(false); }
  };
  if (!data) return <div className="pg-perf-entry"><button className="btn" disabled={loading} onClick={read}>{loading ? 'Reading cues / grid…' : 'Compare cues / grid'}</button><span className="pg-comparison-state">Read only · exact audio</span>{error && <span role="alert">{error}</span>}</div>;
  const sides: PerfDiffSides = {
    libraryGrid: data.library.tempo_changes ? { tempo_changes: data.library.tempo_changes } : null,
    libraryCues: data.library.cues.filter(c => c.kind !== 'main'),
    libraryMaincue: data.library.cues.find(c => c.kind === 'main')?.time ?? null,
    externals: [{ sid: 'rekordbox', label: 'USB', color: '#FF1744', grid: null,
      cues: data.usb.cues, maincue: null,
      beats: data.usb.beats.map(b => ({ time: b.time, isDownbeat: b.beat === 1 })) }],
  };
  return <section className="pg-perf" aria-label="USB and Library cue/grid comparison">
    <div className="pg-context-head"><b>Cues / grid</b><span className="pg-tag">Read only</span><span className="pg-comparison-state">Newer source unknown</span></div>
    {data.usb.state === 'read' ? <>
      <PerfDiffViewer trackId={data.track_id} sides={sides} onImport={{}} useSavedMaincue={false} referenceLabel="Shared Library waveform · verified exact-file audio. USB supplies cue/grid overlays only." />
      <div className="pg-perf-summary"><span>Library · {data.library.cues.length} cues · {data.library.grid_state === 'unavailable' ? 'grid unreadable' : data.library.grid_origin ?? 'no saved grid'}</span><span>USB · {data.usb.cues.length} cues · {data.usb.beats.length} stored beats{data.usb.grid_truncated ? ' (truncated)' : ''}</span></div>
    </> : <p role="status">{data.usb.reason} USB comparison unknown.</p>}
    <details className="pg-exact"><summary>Stored cue values and alignment</summary>
      <p>{data.alignment}. USB offset: {data.usb.decode_offset_ms ?? 'unknown'}ms. M = memory cue; loop brackets mark stored loop ends.</p>
      <table className="pg-perf-values"><thead><tr><th>Source</th><th>Kind</th><th>Time / loop end</th><th>Label</th></tr></thead><tbody>{(['library', 'usb'] as const).flatMap(source => data[source].cues.map((c, i) => <tr key={`${source}:${i}`}><td>{source === 'usb' ? 'USB' : 'Library'}</td><td>{cueName(c)}</td><td>{timestamp(c.time)}{c.loop_end != null ? ` / ${timestamp(c.loop_end)}` : ''}</td><td>{c.color && <span className="pdv-swatch" style={{ background: c.color }} />}{c.label ?? 'No label'}</td></tr>))}</tbody></table>
      {data.limits.map(text => <p key={text}>{text}</p>)}
    </details>
  </section>;
}
