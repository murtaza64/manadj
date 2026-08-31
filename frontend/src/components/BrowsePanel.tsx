/**
 * The ONE bottom-panel browse surface (gh#165). Previously every top-panel
 * mode mounted its own Library instance inside its own subtree (App's
 * library mode, the Performance embed, the editor's browsePanel), so the
 * visible bottom panel changed component identity on every mode switch —
 * KeepAliveView only saved revisits, and browseStore/setStore faked
 * continuity across the remounts. Now ONE Library mounts here, once, as an
 * App-level sibling of the mode top panels, and never remounts on mode
 * switches.
 *
 * Mode views stay the policy owners: they register their load routing
 * (registerBrowseHost) and drive the table from their own keyboard hubs
 * through the shared handle (sharedBrowseHandle, browseHost.ts). The panel
 * just picks the ACTIVE mode's policy. In library mode the instance
 * additionally renders its Player/TagEditor block and keyboard hub
 * (browseOnly=false) — that block mounts/unmounts with the mode; the
 * browse surface below it never does.
 */
import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import Library from './Library';
import type { AppMode } from './TopBar';
import { browseHostFor, isBrowseMode, sharedBrowseHandle, subscribeBrowseHosts } from './browseHost';
import type { BrowseMode } from './browseHost';
import { DeckScope } from '../contexts/DeckContext';
import { ViewActiveContext } from '../contexts/viewActive';
import { useDecks } from '../hooks/useDeck';
import { useDeckLocked } from './performance/deckLock';

/**
 * Self-subscribing lock-dim wrapper (moved from PerformanceView, issue 10):
 * the lock booleans flip exactly when a deck starts/stops — subscribing any
 * higher re-rendered the whole browse tree right as playback started
 * (visible jitter). Here a flip restyles only this div; the children
 * element (created by BrowsePanel) is identity-stable, so React skips the
 * table. Always mounted (structure must never change around the Library or
 * it remounts); the classes apply only under the Performance load lock.
 */
function BrowseSurfaceFrame({
  lockEnabled,
  visible,
  children,
}: {
  lockEnabled: boolean;
  visible: boolean;
  children: ReactNode;
}) {
  const decks = useDecks();
  const lockedA = useDeckLocked(decks.A.engine);
  const lockedB = useDeckLocked(decks.B.engine);
  const lockedC = useDeckLocked(decks.C.engine);
  const lockedD = useDeckLocked(decks.D.engine);
  const lockClasses = lockEnabled
    ? `${lockedA ? ' lock-A' : ''}${lockedB ? ' lock-B' : ''}${lockedC ? ' lock-C' : ''}${
        lockedD ? ' lock-D' : ''
      }`
    : '';
  return (
    <div
      className={`app-browse${lockClasses}`}
      style={visible ? undefined : { display: 'none' }}
    >
      {children}
    </div>
  );
}

export function BrowsePanel({ mode }: { mode: AppMode }) {
  // Latch the last BROWSE mode (same derived-state idiom as KeepAliveView):
  // while a config page is up the panel hides but must stay UNTOUCHED —
  // flapping browseOnly there would churn the Player/TagEditor block.
  const [browseMode, setBrowseMode] = useState<BrowseMode>(
    isBrowseMode(mode) ? mode : 'library'
  );
  if (isBrowseMode(mode) && mode !== browseMode) setBrowseMode(mode);
  const visible = isBrowseMode(mode);

  const host = useSyncExternalStore(subscribeBrowseHosts, () =>
    browseMode === 'library' ? undefined : browseHostFor(browseMode)
  );

  return (
    <ViewActiveContext.Provider value={visible}>
      <BrowseSurfaceFrame lockEnabled={browseMode === 'performance'} visible={visible}>
        {/* The browse surface is Deck A everywhere (performance-mode 02). */}
        <DeckScope deck="A">
          <Library
            browseOnly={browseMode !== 'library'}
            onLoadToDeck={host?.onLoadToDeck}
            doubleClickDeck={host?.doubleClickDeck ?? 'A'}
            rowActions={host?.rowActions}
            onRowDoubleClick={host?.onDoubleClick}
            browseRef={sharedBrowseHandle}
          />
        </DeckScope>
      </BrowseSurfaceFrame>
    </ViewActiveContext.Provider>
  );
}
