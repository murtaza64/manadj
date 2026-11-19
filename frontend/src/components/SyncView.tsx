import { useCallback, useEffect, useRef, useState } from 'react';
import { PlaylistSync } from './PlaylistSync';
import { AcquisitionView } from './acquisition/AcquisitionView';
import { useAcquisitionAvailable } from './acquisition/useAcquisitionAvailable';
import { OPEN_ACQUISITION_EVENT, peekPendingAcquisition } from './acquisition/openAcquisition';
import { UnifiedTracksSync } from './UnifiedTracksSync';
import { RekordboxImportGuide } from '../onboarding/RekordboxImportGuide';
import './SyncView.css';
import { SyncWorkspace } from './SyncWorkspace';
import { ExternalDrivesSync } from './ExternalDrivesSync';
import { SyncBrowser } from './SyncBrowser';
import { OPEN_SYNC_WORKSPACE_EVENT, takeSyncWorkspace } from '../sync/openWorkspace';
import { OPEN_USB_SYNC_EVENT, takeUsbSyncFocus, type OpenUsbSyncDetail } from '../sync/openUsbSync';

type TabType = 'overview' | 'workspace' | 'tracks' | 'playlists' | 'usb-drives' | 'acquisition' | 'rekordbox-import';

const TABS: { id: TabType; label: string }[] = [
  { id: 'overview', label: 'Sync' },
  { id: 'workspace', label: 'Field review' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'usb-drives', label: 'USB tracks' },
  { id: 'acquisition', label: 'Acquisition' },
  { id: 'rekordbox-import', label: 'Rekordbox import' },
];

/** The Sync mode: a normal top-bar mode (the persistent TopBar is the way
 * in and out), with a slim secondary tab row in the topbar design language. */
export function SyncView() {
  const [selectedTab, setActiveTab] = useState<TabType>(() => (peekPendingAcquisition() ? 'acquisition' : 'overview'));
  const [request, setRequest] = useState(takeSyncWorkspace);
  const [busy, setBusy] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const pending = useRef(false);
  const onPendingChange = useCallback((value: boolean) => { pending.current = value; setBusy(value); }, []);
  useEffect(() => {
    const open = () => { const next = takeSyncWorkspace(); if (next && !pending.current) { setRequest(next); setActiveTab('workspace'); } };
    window.addEventListener(OPEN_SYNC_WORKSPACE_EVENT, open);
    return () => window.removeEventListener(OPEN_SYNC_WORKSPACE_EVENT, open);
  }, []);
  // a task worklist "open in Acquisition" (gh#342) while already mounted
  useEffect(() => {
    const open = () => { if (!pending.current) setActiveTab('acquisition'); };
    window.addEventListener(OPEN_ACQUISITION_EVENT, open);
    return () => window.removeEventListener(OPEN_ACQUISITION_EVENT, open);
  }, []);
  // "Sync from USB..." on a playlist surface: land on the USB drives tab
  // with the originating playlist carried along for highlighting. A
  // pending operation guards the switch like every other entry.
  const [usbFocus, setUsbFocus] = useState<string | null>(null);
  // Sub-view of the Sync tab, not a tab of its own.
  useEffect(() => {
    const open = (event: Event) => {
      const stashed = takeUsbSyncFocus();
      const detail = (event as CustomEvent<OpenUsbSyncDetail>).detail ?? stashed;
      setUsbFocus(detail?.playlistName ?? null);
      if (!pending.current) setActiveTab('usb-drives');
    };
    window.addEventListener(OPEN_USB_SYNC_EVENT, open);
    return () => window.removeEventListener(OPEN_USB_SYNC_EVENT, open);
  }, []);
  // Came from another surface: the event fired before this view mounted,
  // so consume the stashed detail once here. (The useState initializer is
  // no place to consume it: StrictMode double-invokes initializers.)
  useEffect(() => {
    const detail = takeUsbSyncFocus();
    if (detail) {
      setUsbFocus(detail.playlistName);
      if (!pending.current) setActiveTab('usb-drives');
    }
  }, []);
  // Acquisition is the wishlist: hidden until SoundCloud or Spotify is
  // set up (Settings → Accounts; setup-guides #290, gh#342, #347).
  const acquisitionAvailable = useAcquisitionAvailable();
  // 'USB drives' (pick individual tracks from a drive) is a tool like the rest and the target of the playlist 'Sync from USB' event.
  const tabs = TABS.filter((t) => (t.id !== 'acquisition' || acquisitionAvailable) && true);
  const activeTab = tabs.some((t) => t.id === selectedTab) ? selectedTab : 'overview';

  return (
    <div className="sync-view-container">
      {activeTab !== 'overview' && (
        <div className="sync-nav" data-tour="sync.tabs">
          <button className="sync-back" disabled={busy} onClick={() => { if (!pending.current) setActiveTab('overview'); }}>← Sync</button>
          <span className="sync-nav-title">{TABS.find((t) => t.id === activeTab)?.label ?? 'USB drives'}</span>
        </div>
      )}

      <div className="sync-workspace-host" hidden={activeTab !== 'workspace'}><SyncWorkspace key={request?.sequence || 0} request={request} onPendingChange={onPendingChange} /></div>
      {/* Stays mounted so the plan survives switching tabs. */}
      <div className="sync-browser-host" hidden={activeTab !== 'overview'}><SyncBrowser toolbar={(
        <div className="sync-tools" data-tour="sync.tabs">
          <button className="btn" aria-expanded={toolsOpen} onClick={() => setToolsOpen((v) => !v)}>Tools</button>
          {toolsOpen && (
            <div className="sync-tools-menu" role="menu">
              {tabs.filter((t) => t.id !== 'overview').map((t) => (
                <button key={t.id} role="menuitem" className="sync-tool" disabled={busy} onClick={() => { setToolsOpen(false); if (!pending.current) setActiveTab(t.id); }}>{t.label}</button>
              ))}
            </div>
          )}
        </div>
      )} /></div>
      {activeTab === 'tracks' && <UnifiedTracksSync />}
      {activeTab === 'playlists' && <PlaylistSync />}
      {activeTab === 'usb-drives' && <ExternalDrivesSync focusPlaylist={usbFocus} />}
      {activeTab === 'acquisition' && <AcquisitionView />}
      {activeTab === 'rekordbox-import' && (
        <div className="onboarding-standalone">
          <RekordboxImportGuide onDone={() => setActiveTab('tracks')} />
        </div>
      )}
    </div>
  );
}
