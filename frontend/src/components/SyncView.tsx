import { useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { TagSync } from './TagSync';
import { TrackSync } from './TrackSync';
import { MetadataSync } from './MetadataSync';
import { Acquisition } from './Acquisition';
import { UnifiedSyncPrototype } from './UnifiedSyncPrototype';
import './SyncView.css';

// PROTOTYPE — dev-only tab; remove with UnifiedSyncPrototype.*
const SHOW_PROTOTYPE = import.meta.env.DEV;

interface SyncViewProps {
  onClose: () => void;
}

type TabType = 'playlists' | 'tags' | 'tracks' | 'metadata' | 'acquisition' | 'unified-proto';

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
          <button
            className={`sync-view-tab ${activeTab === 'metadata' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('metadata')}
          >
            Metadata
          </button>
          <button
            className={`sync-view-tab ${activeTab === 'acquisition' ? 'sync-view-tab-active' : ''}`}
            onClick={() => setActiveTab('acquisition')}
          >
            Acquisition
          </button>
          {SHOW_PROTOTYPE && (
            <button
              className={`sync-view-tab ${activeTab === 'unified-proto' ? 'sync-view-tab-active' : ''}`}
              onClick={() => setActiveTab('unified-proto')}
            >
              Unified (proto)
            </button>
          )}
        </div>
        <button onClick={onClose} className="sync-view-close-button">
          Close
        </button>
      </div>

      {activeTab === 'playlists' && <PlaylistSync onClose={onClose} />}
      {activeTab === 'tags' && <TagSync />}
      {activeTab === 'tracks' && <TrackSync onClose={onClose} />}
      {activeTab === 'metadata' && <MetadataSync />}
      {activeTab === 'acquisition' && <Acquisition />}
      {SHOW_PROTOTYPE && activeTab === 'unified-proto' && <UnifiedSyncPrototype />}
    </div>
  );
}
