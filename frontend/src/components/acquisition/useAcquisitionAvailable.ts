// Gate for the Acquisition tab (gh#342): visible when any Supplier is
// configured — SoundCloud (likes + direct downloads) or Soulseek (search
// for any track) — not only SoundCloud.
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export const SUPPLIERS_KEY = ['acquisitionSuppliers'] as const;

export function useAcquisitionAvailable(): boolean {
  const { data } = useQuery({
    queryKey: SUPPLIERS_KEY,
    queryFn: api.acquisition.getSuppliers,
    staleTime: 5 * 60 * 1000,
  });
  return (data ?? []).length > 0;
}
