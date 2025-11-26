import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TrackList from './components/TrackList';
import { FilterProvider } from './contexts/FilterContext';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FilterProvider>
        <div className="w-full h-full flex flex-col container-base">
          <main className="p-0 flex-1 overflow-auto">
            <TrackList />
          </main>
        </div>
      </FilterProvider>
    </QueryClientProvider>
  );
}

export default App;
