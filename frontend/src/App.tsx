import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api/queryClient';

// Waveform style panel (edits the persisted style slots live).
const StyleTuningPage = lazy(() => import('./waveform/StyleTuningPage'));
const MidiInspectorPage = lazy(() => import('./midi/MidiInspectorPage'));
const JogTuningPage = lazy(() => import('./midi/JogTuningPage'));
const VisualizerApp = lazy(() => import('./visualizer/VisualizerApp'));
const ArenaApp = lazy(() => import('./visualizer/ArenaApp'));
import Library from './components/Library';
import { SyncView } from './components/SyncView';
import { PerformanceView } from './components/performance/PerformanceView';
import { TopBar } from './components/TopBar';
import type { AppMode } from './components/TopBar';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider, DeckScope } from './contexts/DeckContext';
import { MidiControllerBridge } from './components/MidiControllerBridge';
import { MidiControlRegistrar } from './components/MidiControlRegistrar';
import { MidiFeedbackBridge } from './components/MidiFeedbackBridge';
import { MidiLevelMeterBridge } from './components/MidiLevelMeterBridge';
import { AudioRoutingBridge } from './components/AudioRoutingBridge';
import { VisualizerBridge } from './components/VisualizerBridge';
import { ConductorPlanFeed } from './sets/ConductorPlanFeed';
import { SetSpaceTransport } from './sets/SetSpaceTransport';
import TransitionEditor from './editor/TransitionEditor';
import { TakeHistoryView } from './components/history/TakeHistoryView';
import { OPEN_SESSION_EVENT } from './sessions/openSession';
import { KeepAliveView } from './contexts/KeepAliveView';
import { OPEN_TAKE_EVENT } from './capture/takeReview';
import { OPEN_PAIR_EVENT } from './editor/openPair';
import { ToastProvider } from './components/Toast';
import { installNoFocusRule } from './focus/noFocusRule';
import { useAnalysisPendingSync } from './hooks/useAnalysisPending';
import { isTypingTarget } from './components/performance/performanceKeys';
import { registerViewToggle } from './midi/controlRegistry';

/** The one poller keeping track rows / Analyze buttons live against
 * background analysis (analysis-curation 03) — a bridge like the MIDI
 * layers: above the view switch, renders nothing. */
function AnalysisPendingBridge() {
  useAnalysisPendingSync();
  return null;
}

const MODE_IDS: AppMode[] = ['library', 'performance', 'transition', 'history', 'sync', 'styles', 'jog-tune'];

/** Session-state persistence of the top-panel mode: reopen where you were. */
const MODE_KEY = 'manadj-app-mode';

// Deep link: ?view=<mode> opens straight into that mode (beats the
// remembered one); otherwise restore the last mode, defaulting to library.
const requestedView = new URLSearchParams(window.location.search).get('view');
const storedView = localStorage.getItem(MODE_KEY);
const initialView: AppMode = MODE_IDS.includes(requestedView as AppMode)
  ? (requestedView as AppMode)
  : MODE_IDS.includes(storedView as AppMode)
    ? (storedView as AppMode)
    : 'library';

function App() {
  const [view, setViewState] = useState<AppMode>(initialView);
  const setView = (mode: AppMode) => {
    setViewState(mode);
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // persistence is best-effort
    }
  };

  // Keyboard-focus hygiene: buttons/checkboxes never take click-focus
  // (keyboard-focus 01) — one enforcement site for the whole app.
  useEffect(installNoFocusRule, []);

  // Performance ⟷ Library toggle (four-deck-performance 24/25): one
  // action, two handles — ` (backtick) app-wide, and the hardware VIEW
  // button through the registry. Other modes are pointer-only
  // destinations; the toggle serves the hardware/keys performance loop.
  const toggleView = () =>
    setViewState((current) => {
      const next = current === 'performance' ? 'library' : 'performance';
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {
        // persistence is best-effort
      }
      return next;
    });
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

  // A Session-moment request (history's "view in Session", sessions 04)
  // opens the Library — Sessions live there now (sidebar section + pane);
  // the mounted Library consumes the selection from the session store.
  useEffect(() => {
    const onOpenSession = () => setView('library');
    window.addEventListener(OPEN_SESSION_EVENT, onOpenSession);
    return () => window.removeEventListener(OPEN_SESSION_EVENT, onOpenSession);
  }, []);

  if (window.location.pathname === '/midi-inspect') {
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
    const arena = new URLSearchParams(window.location.search).has('arena');
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
        <FilterProvider>
          <div className="app-shell">
            <TopBar mode={view} onModeChange={setView} />
            <main className="app-main">
              {/* The three DECK modes keep alive (perf-layout 09): they
                  mount on first visit and then hide instead of unmounting,
                  so zoom/scroll/panel state survives mode switches in
                  every component at once. Config-ish pages stay
                  conditional — remounting them is cheap and honest. */}
              <KeepAliveView active={view === 'performance'}>
                <PerformanceView />
              </KeepAliveView>
              <KeepAliveView active={view === 'transition'}>
                <TransitionEditor />
              </KeepAliveView>
              <KeepAliveView active={view === 'library'}>
                {/* The library view is Deck A (performance-mode issue 02). */}
                <DeckScope deck="A">
                  <Library />
                </DeckScope>
              </KeepAliveView>
              {view === 'history' ? (
                <TakeHistoryView />
              ) : view === 'sync' ? (
                <SyncView />
              ) : view === 'styles' ? (
                <Suspense fallback={null}>
                  <StyleTuningPage />
                </Suspense>
              ) : view === 'jog-tune' ? (
                <Suspense fallback={null}>
                  <JogTuningPage />
                </Suspense>
              ) : null}
            </main>
          </div>
        </FilterProvider>
      </DeckProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
