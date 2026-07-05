import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Waveform style panel (edits the persisted style slots live).
const StyleTuningPage = lazy(() => import('./waveform/StyleTuningPage'));
const MidiInspectorPage = lazy(() => import('./midi/MidiInspectorPage'));
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
import { AudioRoutingBridge } from './components/AudioRoutingBridge';
import TransitionEditor from './editor/TransitionEditor';
import { TakeHistoryView } from './components/history/TakeHistoryView';
import { OPEN_TAKE_EVENT } from './capture/takeReview';
import { OPEN_PAIR_EVENT } from './editor/openPair';
import { ToastProvider } from './components/Toast';
import { installNoFocusRule } from './focus/noFocusRule';

const queryClient = new QueryClient();

const MODE_IDS: AppMode[] = ['library', 'performance', 'transition', 'history', 'sync', 'styles'];

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

  if (window.location.pathname === '/midi-inspect') {
    return (
      <Suspense fallback={null}>
        <MidiInspectorPage />
      </Suspense>
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
        <AudioRoutingBridge />
        <FilterProvider>
          <div className="app-shell">
            <TopBar mode={view} onModeChange={setView} />
            <main className="app-main">
              {view === 'performance' ? (
                <PerformanceView />
              ) : view === 'transition' ? (
                <TransitionEditor />
              ) : view === 'history' ? (
                <TakeHistoryView />
              ) : view === 'sync' ? (
                <SyncView />
              ) : view === 'styles' ? (
                <Suspense fallback={null}>
                  <StyleTuningPage />
                </Suspense>
              ) : (
                /* The library view is Deck A (performance-mode issue 02). */
                <DeckScope deck="A">
                  <Library />
                </DeckScope>
              )}
            </main>
          </div>
        </FilterProvider>
      </DeckProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
