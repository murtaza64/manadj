import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Library from './components/Library';
import { SyncView } from './components/SyncView';
import { PracticeView } from './components/PracticeView';
import { FilterProvider } from './contexts/FilterContext';
import { DeckProvider } from './contexts/DeckContext';

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
            <PracticeView onClose={() => setView('library')} />
          ) : (
            <Library
              onOpenPlaylistSync={() => setView('sync')}
              onOpenPractice={() => setView('practice')}
            />
          )}
        </FilterProvider>
      </DeckProvider>
    </QueryClientProvider>
  );
}

export default App;
