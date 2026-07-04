import { lazy, Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Waveform style panel (edits the persisted style slots live).
const StyleTuningPage = lazy(() => import('./waveform/StyleTuningPage'));
import Library from './components/Library';
import { SyncView } from './components/SyncView';
import { PerformanceView } from './components/performance/PerformanceView';
import { TopBar } from './components/TopBar';
import type { AppMode } from './components/TopBar';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider, DeckScope } from './contexts/DeckContext';
import { MidiControllerBridge } from './components/MidiControllerBridge';
import TransitionEditor from './editor/TransitionEditor';
import { ToastProvider } from './components/Toast';

const queryClient = new QueryClient();

const MODE_IDS: AppMode[] = ['library', 'performance', 'transition', 'sync', 'styles'];

// Deep link: ?view=<mode> opens straight into that mode.
const requestedView = new URLSearchParams(window.location.search).get('view');
const initialView: AppMode = MODE_IDS.includes(requestedView as AppMode)
  ? (requestedView as AppMode)
  : 'library';

function App() {
  const [view, setView] = useState<AppMode>(initialView);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
      <DeckProvider>
        {/* Controller layer: above the view switch, like the Decks it drives. */}
        <MidiControllerBridge />
        <FilterProvider>
          <div className="app-shell">
            <TopBar mode={view} onModeChange={setView} />
            <main className="app-main">
              {view === 'performance' ? (
                <PerformanceView />
              ) : view === 'transition' ? (
                <TransitionEditor />
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
