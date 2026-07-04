import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Library from './components/Library';
import { SyncView } from './components/SyncView';
import { PerformanceView } from './components/performance/PerformanceView';
import { TopBar } from './components/TopBar';
import type { AppMode } from './components/TopBar';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider, DeckScope } from './contexts/DeckContext';
import { MidiControllerBridge } from './components/MidiControllerBridge';
import TransitionEditor from './editor/TransitionEditor';

const queryClient = new QueryClient();

const MODE_IDS: AppMode[] = ['library', 'performance', 'transition', 'sync'];

// Deep link: ?view=<mode> opens straight into that mode.
const requestedView = new URLSearchParams(window.location.search).get('view');
const initialView: AppMode = MODE_IDS.includes(requestedView as AppMode)
  ? (requestedView as AppMode)
  : 'library';

function App() {
  const [view, setView] = useState<AppMode>(initialView);

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}

export default App;
