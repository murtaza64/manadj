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
import { ToastProvider } from './components/Toast';

const queryClient = new QueryClient();

const MODE_IDS: AppMode[] = ['library', 'performance', 'transition', 'history', 'sync', 'styles'];

// Deep link: ?view=<mode> opens straight into that mode.
const requestedView = new URLSearchParams(window.location.search).get('view');
const initialView: AppMode = MODE_IDS.includes(requestedView as AppMode)
  ? (requestedView as AppMode)
  : 'library';

function App() {
  const [view, setView] = useState<AppMode>(initialView);

  // A Take review request (Transition history row) opens the editor; the
  // mounted editor consumes the pending uuid itself (takeReview.ts).
  useEffect(() => {
    const onOpenTake = () => setView('transition');
    window.addEventListener(OPEN_TAKE_EVENT, onOpenTake);
    return () => window.removeEventListener(OPEN_TAKE_EVENT, onOpenTake);
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
