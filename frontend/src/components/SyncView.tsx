import { useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { Acquisition } from './Acquisition';
import { UnifiedTracksSync } from './UnifiedTracksSync';
import './SyncView.css';

interface SyncViewProps {
  onClose: () => void;
}

type TabType = 'tracks' | 'playlists' | 'acquisition';

export function SyncView({ onClose }: SyncViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('tracks');

  return (
    <div className="sync-view-container">
      <div className="sync-view-top-bar">
        <h1 className="sync-view-title">Sync Status</h1>
        <div className="sync-view-tabs">
          <button
            className={`sync-view-tab ${activeTab === 'tracks' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('tracks')}
          >
            Tracks
          </button>
          <button
            className={`sync-view-tab ${activeTab === 'playlists' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('playlists')}
          >
            Playlists
          </button>
          <button
            className={`sync-view-tab ${activeTab === 'acquisition' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('acquisition')}
          >
            Acquisition
          </button>
        </div>
        <button onClick={onClose} className="sync-view-close-button">
          Close
        </button>
      </div>

      {activeTab === 'tracks' && <UnifiedTracksSync />}
      {activeTab === 'playlists' && <PlaylistSync onClose={onClose} />}
      {activeTab === 'acquisition' && <Acquisition />}
    </div>
  );
}
