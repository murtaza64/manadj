// Query key + invalidation for the Source Item list (gh#342).
import { useQueryClient } from '@tanstack/react-query';

export const ITEMS_KEY = ['acquisitionItems'] as const;

export function useInvalidateItems() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ITEMS_KEY });
}
