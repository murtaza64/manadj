import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Library from './components/Library';
import { SyncView } from './components/SyncView';
import { PerformanceView } from './components/performance/PerformanceView';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider, DeckScope } from './contexts/DeckContext';
import MixEditorProto from './prototype/MixEditorProto';

const queryClient = new QueryClient();

type View = 'library' | 'sync' | 'performance';

// PROTOTYPE (mix-editor): ?proto=mix renders the throwaway two-track arranger.
const showMixProto = new URLSearchParams(window.location.search).get('proto') === 'mix';

function App() {
  const [view, setView] = useState<View>('library');

  if (showMixProto) {
    return (
      <QueryClientProvider client={queryClient}>
        <DeckProvider>
          <FilterProvider>
            <MixEditorProto />
          </FilterProvider>
        </DeckProvider>
      </QueryClientProvider>
    );
  }

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
