import type { TrackDiscrepancy } from '../types';
import './TrackDiscrepancyTable.css';

interface TrackDiscrepancyTableProps {
  exportCandidates: TrackDiscrepancy[];
  importCandidates: TrackDiscrepancy[];
  target: 'engine' | 'rekordbox';
}

export function TrackDiscrepancyTable({
  exportCandidates,
  importCandidates,
  target
}: TrackDiscrepancyTableProps) {
  return (
    <div className="track-discrepancy-container">
      {/* Export Candidates Section */}
      <div className="discrepancy-section">
        <h3>Missing in {target} ({exportCandidates.length})</h3>
        <div className="discrepancy-subtitle">
          These tracks exist in manadj but not in {target}
        </div>

        {exportCandidates.length === 0 ? (
          <div className="empty-state">No missing tracks</div>
        ) : (
          <table className="discrepancy-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Title</th>
                <th>Artist</th>
                <th>BPM</th>
                <th>Key</th>
              </tr>
            </thead>
            <tbody>
              {exportCandidates.map((track, idx) => (
                <tr key={idx}>
                  <td className="filename">{track.filename}</td>
                  <td>{track.title || '—'}</td>
                  <td>{track.artist || '—'}</td>
                  <td>{track.bpm ? `${(track.bpm / 100).toFixed(1)}` : '—'}</td>
                  <td>{track.key !== null && track.key !== undefined ? track.key : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Import Candidates Section */}
      <div className="discrepancy-section">
        <h3>Missing in manadj ({importCandidates.length})</h3>
        <div className="discrepancy-subtitle">
          These tracks exist in {target} but not in manadj
        </div>

        {importCandidates.length === 0 ? (
          <div className="empty-state">No missing tracks</div>
        ) : (
          <table className="discrepancy-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Title</th>
                <th>Artist</th>
                <th>BPM</th>
                <th>Key</th>
              </tr>
            </thead>
            <tbody>
              {importCandidates.map((track, idx) => (
                <tr key={idx}>
                  <td className="filename">{track.filename}</td>
                  <td>{track.title || '—'}</td>
                  <td>{track.artist || '—'}</td>
                  <td>{track.bpm ? `${(track.bpm / 100).toFixed(1)}` : '—'}</td>
                  <td>{track.key !== null && track.key !== undefined ? track.key : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
