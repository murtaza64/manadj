import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Library from './components/Library';
import { SyncView } from './components/SyncView';
import { PerformanceView } from './components/performance/PerformanceView';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider, DeckScope } from './contexts/DeckContext';

const queryClient = new QueryClient();

type View = 'library' | 'sync' | 'performance';

function App() {
  const [view, setView] = useState<View>('library');

  return (
    <QueryClientProvider client={queryClient}>
      <DeckProvider>
        <FilterProvider>
          {view === 'sync' ? (
            <SyncView onClose={() => setView('library')} />
          ) : view === 'performance' ? (
            <PerformanceView onClose={() => setView('library')} />
          ) : (
            /* The library view is Deck A (performance-mode issue 02). */
            <DeckScope deck="A">
              <Library
                onOpenPlaylistSync={() => setView('sync')}
                onOpenPerformance={() => setView('performance')}
              />
            </DeckScope>
          )}
        </FilterProvider>
      </DeckProvider>
    </QueryClientProvider>
  );
}

export default App;
