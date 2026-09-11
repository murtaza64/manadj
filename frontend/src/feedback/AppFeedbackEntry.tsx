import { useDecks } from '../hooks/useDeck';
import { useMixer } from '../hooks/useMixer';
import { useFilters } from '../contexts/FilterContext';
import { FeedbackEntry } from './FeedbackEntry';
import { appReaders } from './appReaders';

export function AppFeedbackEntry({ view }: { view: string }) {
  const decks = useDecks();
  const mixer = useMixer();
  const { filters } = useFilters();
  return <FeedbackEntry readers={appReaders(view, decks, mixer, filters)} />;
}
