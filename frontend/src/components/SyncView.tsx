import { useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { TagSync } from './TagSync';
import { TrackSync } from './TrackSync';
import './SyncView.css';

interface SyncViewProps {
  onClose: () => void;
}

type TabType = 'playlists' | 'tags' | 'tracks';

export function SyncView({ onClose }: SyncViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('playlists');

  return (
    <div className="sync-view-container">
      <div className="sync-view-top-bar">
        <h1 className="sync-view-title">Sync Status</h1>
        <div className="sync-view-tabs">
          <button
            className={`sync-view-tab ${activeTab === 'playlists' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('playlists')}
          >
            Playlists
          </button>
          <button
            className={`sync-view-tab ${activeTab === 'tags' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('tags')}
          >
            Tags
          </button>
          <button
            className={`sync-view-tab ${activeTab === 'tracks' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('tracks')}
          >
            Tracks
          </button>
        </div>
        <button onClick={onClose} className="sync-view-close-button">
          Close
        </button>
      </div>

      {activeTab === 'playlists' && <PlaylistSync onClose={onClose} />}
      {activeTab === 'tags' && <TagSync />}
      {activeTab === 'tracks' && <TrackSync onClose={onClose} />}
    </div>
  );
}
