import { useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { AcquisitionView } from './acquisition/AcquisitionView';
import { useAcquisitionAvailable } from './acquisition/useAcquisitionAvailable';
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
  const [selectedTab, setActiveTab] = useState<TabType>('tracks');
  // Acquisition needs a Supplier: hidden until SoundCloud or Soulseek is
  // set up (Settings → Accounts; setup-guides #290/#291, gh#342).
  const acquisitionAvailable = useAcquisitionAvailable();
  const tabs = TABS.filter((t) => t.id !== 'acquisition' || acquisitionAvailable);
  const activeTab = tabs.some((t) => t.id === selectedTab) ? selectedTab : 'tracks';

  return (
    <div className="sync-view-container">
      <div className="sync-view-tabs" data-tour="sync.tabs">
        {tabs.map((t) => (
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
      {activeTab === 'acquisition' && <AcquisitionView />}
      {activeTab === 'rekordbox-import' && (
        <div className="onboarding-standalone">
          <RekordboxImportGuide onDone={() => setActiveTab('tracks')} />
        </div>
      )}
    </div>
  );
}
