import { useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { Acquisition } from './Acquisition';
import { UnifiedTracksSync } from './UnifiedTracksSync';
import './SyncView.css';

type TabType = 'tracks' | 'playlists' | 'acquisition';

const TABS: { id: TabType; label: string }[] = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'acquisition', label: 'Acquisition' },
];

/** The Sync mode: a normal top-bar mode (the persistent TopBar is the way
 * in and out), with a slim secondary tab row in the topbar design language. */
export function SyncView() {
  const [activeTab, setActiveTab] = useState<TabType>('tracks');

  return (
    <div className="sync-view-container">
      <div className="sync-view-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`sync-view-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'tracks' && <UnifiedTracksSync />}
      {activeTab === 'playlists' && <PlaylistSync />}
      {activeTab === 'acquisition' && <Acquisition />}
    </div>
  );
}
