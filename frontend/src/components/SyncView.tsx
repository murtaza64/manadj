import { useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { Acquisition } from './Acquisition';
import { UnifiedTracksSync } from './UnifiedTracksSync';
import { RekordboxImportGuide } from '../onboarding/RekordboxImportGuide';
import './SyncView.css';

type TabType = 'tracks' | 'playlists' | 'acquisition' | 'rekordbox-import';

const TABS: { id: TabType; label: string }[] = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'rekordbox-import', label: 'Rekordbox import' },
];

/** The Sync mode: a normal top-bar mode (the persistent TopBar is the way
 * in and out), with a slim secondary tab row in the topbar design language. */
export function SyncView() {
  const [activeTab, setActiveTab] = useState<TabType>('tracks');

  return (
    <div className="sync-view-container">
      <div className="sync-view-tabs" data-tour="sync.tabs">
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
      {/* Rekordbox onboarding import, reachable after First run (#275). */}
      {activeTab === 'rekordbox-import' && (
        <div className="onboarding-standalone">
          <RekordboxImportGuide onDone={() => setActiveTab('tracks')} />
        </div>
      )}
    </div>
  );
}
