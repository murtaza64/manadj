import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Library from './components/Library';
import { SyncView } from './components/SyncView';
import { PerformanceViewPrototype } from './components/prototype/PerformanceViewPrototype';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider, DeckScope } from './contexts/DeckContext';

const queryClient = new QueryClient();

type View = 'library' | 'sync' | 'practice';

function App() {
  const [view, setView] = useState<View>('library');

  return (
    <QueryClientProvider client={queryClient}>
      <DeckProvider>
        <FilterProvider>
          {view === 'sync' ? (
            <SyncView onClose={() => setView('library')} />
          ) : view === 'practice' ? (
            /* Placeholder until the real Performance view (issue 03) — the
               Practice view is deleted (performance-mode issue 01). The
               prototype is single-deck; park it on A. */
            <DeckScope deck="A">
              <PerformanceViewPrototype onClose={() => setView('library')} />
            </DeckScope>
          ) : (
            /* The library view is Deck A (performance-mode issue 02). */
            <DeckScope deck="A">
              <Library
                onOpenPlaylistSync={() => setView('sync')}
                onOpenPractice={() => setView('practice')}
              />
            </DeckScope>
          )}
        </FilterProvider>
      </DeckProvider>
    </QueryClientProvider>
  );
}

export default App;
