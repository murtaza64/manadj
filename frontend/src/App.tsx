import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';
import { DEV_SURFACES } from './devMode';

const SettingsPage = lazy(() => import('./settings/SettingsPage'));
const MidiInspectorPage = lazy(() => import('./midi/MidiInspectorPage'));
const VisualizerApp = lazy(() => import('./visualizer/VisualizerApp'));
const ArenaApp = lazy(() => import('./visualizer/ArenaApp'));
import { BrowsePanel } from './components/BrowsePanel';
import { isBrowseMode } from './components/browseHost';
import { SyncView } from './components/SyncView';
import { PerformanceView } from './components/performance/PerformanceView';
import { TopBar } from './components/TopBar';
import type { AppMode } from './components/TopBar';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider } from './contexts/DeckContext';
import { MidiControllerBridge } from './components/MidiControllerBridge';
import { MidiControlRegistrar } from './components/MidiControlRegistrar';
import { MidiFeedbackBridge } from './components/MidiFeedbackBridge';
import { MidiLevelMeterBridge } from './components/MidiLevelMeterBridge';
import { AudioRoutingBridge } from './components/AudioRoutingBridge';
import { VisualizerBridge } from './components/VisualizerBridge';
import { ConductorPlanFeed } from './sets/ConductorPlanFeed';
import { SetSpaceTransport } from './sets/SetSpaceTransport';
import TransitionEditor from './editor/TransitionEditor';
import RoutineEditorView from './routines/RoutineEditorView';
import { OPEN_ROUTINE_EVENT } from './routines/openRoutine';
import { OPEN_MIX_EVENT } from './routines/openMix';
import { TakeHistoryView } from './components/history/TakeHistoryView';
import { OPEN_SESSION_EVENT } from './sessions/openSession';
import { KeepAliveView } from './contexts/KeepAliveView';
import { BrowseActiveContext } from './contexts/browseActive';
import { OPEN_TAKE_EVENT } from './capture/takeReview';
import { OPEN_PAIR_EVENT } from './editor/openPair';
import { ToastProvider } from './components/Toast';
import { installNoFocusRule } from './focus/noFocusRule';
import { useAnalysisPendingSync } from './hooks/useAnalysisPending';
import { isTypingTarget } from './components/performance/performanceKeys';
import { registerViewToggle } from './midi/controlRegistry';
import { FirstRunWelcome } from './onboarding/FirstRunWelcome';
import './setup/allGuides';
import { KeyboardShortcutOverlay } from './components/KeyboardShortcutOverlay';
import { TourController } from './tour/TourController';
import { TutorialController } from './tutorials/TutorialController';
import { OPEN_TUTORIAL_EVENT } from './tutorials/tutorialState';
import { setTourArea, type TourArea } from './tour/tourState';

/** Where each mode lands in the tour's section map (feature-tour #282):
 * the legacy pair editor counts as the mix editor's area. */
const TOUR_AREA_BY_MODE: Record<AppMode, TourArea> = {
  library: 'library',
  performance: 'performance',
  transition: 'edit',
  routine: 'edit',
  history: 'history',
  sync: 'sync',
};

/** The one poller keeping track rows / Analyze buttons live against
 * background analysis (analysis-curation 03) — a bridge like the MIDI
 * layers: above the view switch, renders nothing. */
function AnalysisPendingBridge() {
  useAnalysisPendingSync();
  return null;
}

const MODE_IDS: AppMode[] = ['library', 'performance', 'transition', 'routine', 'history', 'sync'];

/** Session-state persistence of the top-panel mode: reopen where you were. */
const MODE_KEY = 'manadj-app-mode';

// Deep link: ?view=<mode> opens straight into that mode (beats the
// remembered one); otherwise restore the last mode. Fresh installs open in
// PERFORM (setup-guides #301).
function initialMode(): AppMode | 'settings' {
  const requestedView = new URLSearchParams(window.location.search).get('view');
  const storedView = localStorage.getItem(MODE_KEY);
  for (const mode of [requestedView, storedView]) {
    // Published Settings links and the former persisted mode remain usable.
    if (mode === 'settings') return mode;
    // The legacy PAIR editor is a dev surface (packaged-app #278): deep
    // links / restores don't open it in production builds. In-app events
    // (take review, pair edit) still can.
    if (mode === 'transition' && !DEV_SURFACES) continue;
    if (MODE_IDS.includes(mode as AppMode)) return mode as AppMode;
  }
  return 'performance';
}

function persistMode(mode: AppMode, settingsOpen = false) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', mode);
  if (settingsOpen) url.searchParams.set('settings', '1');
  else url.searchParams.delete('settings');
  window.history.replaceState(null, '', url);
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // persistence is best-effort
  }
}

function App() {
  const [view, setViewState] = useState<AppMode>(() => {
    const mode = initialMode();
    return mode === 'settings' ? 'performance' : mode;
  });
  const [settingsOpen, setSettingsOpen] = useState(() =>
    new URLSearchParams(window.location.search).get('settings') === '1' || initialMode() === 'settings'
  );
  const setView = (mode: AppMode) => {
    setSettingsOpen(false);
    setViewState(mode);
    persistMode(mode);
  };
  const toggleSettings = () => {
    setSettingsOpen(!settingsOpen);
    persistMode(view, !settingsOpen);
  };

  // Keyboard-focus hygiene: buttons/checkboxes never take click-focus
  // (keyboard-focus 01) — one enforcement site for the whole app.
  useEffect(installNoFocusRule, []);

  // Tour activity (feature-tour #282): tell the tour where the user is;
  // TourController auto-starts unseen sections' coach marks from this.
  useEffect(() => {
    setTourArea(settingsOpen ? 'settings' : TOUR_AREA_BY_MODE[view]);
  }, [view, settingsOpen]);

  // Performance ⟷ Library toggle (four-deck-performance 24/25): one
  // action, two handles — ` (backtick) app-wide, and the hardware VIEW
  // button through the registry. Other modes are pointer-only
  // destinations; the toggle serves the hardware/keys performance loop.
  const toggleView = () => {
    setSettingsOpen(false);
    setViewState((current) => {
      const next = current === 'performance' ? 'library' : 'performance';
      persistMode(next);
      return next;
    });
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '`' || isTypingTarget(event)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      toggleView();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => registerViewToggle(toggleView), []);
  useEffect(() => {
    const open = (event: Event) => setView((event as CustomEvent).detail === 'performance' ? 'performance' : 'routine');
    window.addEventListener(OPEN_TUTORIAL_EVENT, open);
    return () => window.removeEventListener(OPEN_TUTORIAL_EVENT, open);
  }, []);

  // A Take review request (Transition history row) opens the editor; the
  // mounted editor consumes the pending uuid itself (takeReview.ts).
  useEffect(() => {
    const onOpenTake = () => setView('transition');
    window.addEventListener(OPEN_TAKE_EVENT, onOpenTake);
    return () => window.removeEventListener(OPEN_TAKE_EVENT, onOpenTake);
  }, []);

  // A pair-edit request (Set-view adjacency, sets 09) opens the editor the
  // same way; the mounted editor consumes the pending request (openPair.ts).
  useEffect(() => {
    const onOpenPair = () => setView('transition');
    window.addEventListener(OPEN_PAIR_EVENT, onOpenPair);
    return () => window.removeEventListener(OPEN_PAIR_EVENT, onOpenPair);
  }, []);

  // A routine-edit request (Set routine pin / history ◆ row, gh#170)
  // opens the Routine editor; the mounted editor consumes it.
  useEffect(() => {
    const onOpenRoutine = () => setView('routine');
    window.addEventListener(OPEN_ROUTINE_EVENT, onOpenRoutine);
    return () => window.removeEventListener(OPEN_ROUTINE_EVENT, onOpenRoutine);
  }, []);

  // A Mix-editor request (#221 phase 3): any artifact kind on the unified
  // surface — rewired entry points ride this one event.
  useEffect(() => {
    const onOpenMix = () => setView('routine');
    window.addEventListener(OPEN_MIX_EVENT, onOpenMix);
    return () => window.removeEventListener(OPEN_MIX_EVENT, onOpenMix);
  }, []);

  // A Session-moment request (history's "view in Session", sessions 04)
  // opens the Library — Sessions live there now (sidebar section + pane);
  // the mounted Library consumes the selection from the session store.
  useEffect(() => {
    const onOpenSession = () => setView('library');
    window.addEventListener(OPEN_SESSION_EVENT, onOpenSession);
    return () => window.removeEventListener(OPEN_SESSION_EVENT, onOpenSession);
  }, []);

  // Dev-only surface (packaged-app #278): hand-typed path, dev builds only.
  if (DEV_SURFACES && window.location.pathname === '/midi-inspect') {
    return (
      <Suspense fallback={null}>
        <MidiInspectorPage />
      </Suspense>
    );
  }

  // The visualizer window (realtime-visualization 01): a standalone root —
  // no DeckProvider, so it can never create a second AudioContext (ADR
  // 0009). Band data arrives over the BroadcastChannel from the main
  // window's VisualizerBridge.
  if (window.location.pathname === '/visualizer') {
    // ?arena=1 → the genetic judging arena (realtime-visualization 06);
    // same standalone rules: no DeckProvider, never an AudioContext.
    // Dev-only (packaged-app #278): the arena writes genepool files into
    // the source tree — never a packaged-app surface.
    const arena = DEV_SURFACES && new URLSearchParams(window.location.search).has('arena');
    return (
      <Suspense fallback={null}>{arena ? <ArenaApp /> : <VisualizerApp />}</Suspense>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
      <DeckProvider>
        {/* Controller layer: above the view switch, like the Decks it drives. */}
        <MidiControllerBridge />
        <MidiControlRegistrar />
        <MidiFeedbackBridge />
        <MidiLevelMeterBridge />
        <AudioRoutingBridge />
        <AnalysisPendingBridge />
        {/* Visualizer band feed (realtime-visualization 01): transmits only
            while a visualizer window pings. */}
        <VisualizerBridge />
        {/* Live re-plan (sets 24): plan-input subscription for the
            conducting Set — above the view switch, like the Conductor
            it feeds. */}
        <ConductorPlanFeed />
        {/* Space → Conductor context (sets 34): plan assembly for the
            SELECTED Set — above the view switch, like the selection. */}
        <SetSpaceTransport />
        {/* Coach-mark tour (feature-tour #282): above the view switch so
            it can spotlight anchors in any mode. */}
            <FirstRunWelcome />
            <TourController />
        <TutorialController />
        <FilterProvider>
          <div className="app-shell">
            <TopBar
              mode={view}
              onModeChange={setView}
              settingsOpen={settingsOpen}
              onSettingsToggle={toggleSettings}
            />
            <main className="app-main">
              <BrowseActiveContext.Provider value={!settingsOpen}>
              {/* Top panels: the deck modes keep alive (perf-layout 09) —
                  mount on first visit, then hide instead of unmounting, so
                  zoom/panel state survives mode switches. Library mode has
                  no top panel of its own (its Player/TagEditor block lives
                   inside the shared panel's Library). Settings replaces only
                   the lower panel, leaving visible deck modes active. */}
              <KeepAliveView active={view === 'performance'}>
                <PerformanceView />
              </KeepAliveView>
              <KeepAliveView active={view === 'transition'}>
                <TransitionEditor />
              </KeepAliveView>
              <KeepAliveView active={view === 'routine'}>
                <RoutineEditorView />
              </KeepAliveView>
              <KeepAliveView active={view === 'history' && !settingsOpen}>
                <TakeHistoryView />
              </KeepAliveView>
              <KeepAliveView active={view === 'sync' && !settingsOpen}>
                <SyncView />
              </KeepAliveView>
              {!isBrowseMode(view) && settingsOpen ? (
                <Suspense fallback={null}>
                  <SettingsPage />
                </Suspense>
              ) : null}
              {/* Bottom panel: the ONE shared Library instance (gh#165) —
                  always mounted, never remounts on mode switches; hides
                  under the config pages. */}
              <BrowsePanel
                mode={view}
                replacement={isBrowseMode(view) && settingsOpen ? (
                  <Suspense fallback={null}>
                    <SettingsPage performance={view === 'performance'} />
                  </Suspense>
                ) : undefined}
              />
              </BrowseActiveContext.Provider>
            </main>
          </div>
          <KeyboardShortcutOverlay mode={view} />
        </FilterProvider>
      </DeckProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
