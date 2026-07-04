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

type View = AppMode | 'sync';

// Deep link: ?view=transition opens straight into the Transition editor.
// It is otherwise a normal top-bar mode.
const initialView: View =
  new URLSearchParams(window.location.search).get('view') === 'transition'
    ? 'transition'
    : 'library';

function App() {
  const [view, setView] = useState<View>(initialView);

  return (
    <QueryClientProvider client={queryClient}>
      <DeckProvider>
        {/* Controller layer: above the view switch, like the Decks it drives. */}
        <MidiControllerBridge />
        <FilterProvider>
          {view === 'sync' ? (
            <SyncView onClose={() => setView('library')} />
          ) : (
            <div className="app-shell">
              <TopBar mode={view} onModeChange={setView} onOpenSync={() => setView('sync')} />
              <main className="app-main">
                {view === 'performance' ? (
                  <PerformanceView />
                ) : view === 'transition' ? (
                  <TransitionEditor />
                ) : (
                  /* The library view is Deck A (performance-mode issue 02). */
                  <DeckScope deck="A">
                    <Library />
                  </DeckScope>
                )}
              </main>
            </div>
          )}
        </FilterProvider>
      </DeckProvider>
    </QueryClientProvider>
  );
}

export default App;
