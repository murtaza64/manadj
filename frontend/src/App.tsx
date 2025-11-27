import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrackList from './components/TrackList';
import { SyncView } from './components/SyncView';
import { FilterProvider } from './contexts/FilterContext';
import { AudioProvider } from './contexts/AudioContext';

const queryClient = new QueryClient();

function App() {
  const [showSyncView, setShowSyncView] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <AudioProvider>
        <FilterProvider>
          {showSyncView ? (
            <SyncView onClose={() => setShowSyncView(false)} />
          ) : (
            <TrackList onOpenPlaylistSync={() => setShowSyncView(true)} />
          )}
        </FilterProvider>
      </AudioProvider>
    </QueryClientProvider>
  );
}

export default App;
