import { useState } from 'react';
import { TrackSyncView } from './TrackSyncView';
import './TrackSync.css';

interface TrackSyncProps {
  onClose: () => void;
}

export function TrackSync({ onClose }: TrackSyncProps) {
  const [selectedTarget, setSelectedTarget] = useState<'engine' | 'rekordbox'>('engine');

  return (
    <div className="track-sync-container">
      <div className="track-sync-header">
        <h2>Track Sync</h2>
        <div className="target-selector">
          <button
            className={selectedTarget === 'engine' ? 'active' : ''}
            onClick={() => setSelectedTarget('engine')}
          >
            Engine DJ
          </button>
          <button
            className={selectedTarget === 'rekordbox' ? 'active' : ''}
            onClick={() => setSelectedTarget('rekordbox')}
          >
            Rekordbox
          </button>
        </div>
        <button onClick={onClose} className="close-button">
          Close
        </button>
      </div>

      <TrackSyncView target={selectedTarget} />
    </div>
  );
}
