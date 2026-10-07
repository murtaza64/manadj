import { useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { Acquisition } from './Acquisition';
import { UnifiedTracksSync } from './UnifiedTracksSync';
import { useSoundCloudConnected } from '../setup/soundcloud/soundcloudApi';
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
  const [selectedTab, setActiveTab] = useState<TabType>('tracks');
  // Acquisition works off SoundCloud likes: hidden until SoundCloud is
  // connected (Settings → SoundCloud, setup-guides #290).
  const soundcloudConnected = useSoundCloudConnected();
  const tabs = TABS.filter((t) => t.id !== 'acquisition' || soundcloudConnected);
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
      {activeTab === 'acquisition' && <Acquisition />}
    </div>
  );
}
