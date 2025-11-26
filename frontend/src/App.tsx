import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrackList from './components/TrackList';
import { FilterProvider } from './contexts/FilterContext';
import { AudioProvider } from './contexts/AudioContext';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AudioProvider>
        <FilterProvider>
          <div className="w-full h-full flex flex-col container-base">
            <main className="p-0 flex-1 overflow-auto">
              <TrackList />
            </main>
          </div>
        </FilterProvider>
      </AudioProvider>
    </QueryClientProvider>
  );
}

export default App;
