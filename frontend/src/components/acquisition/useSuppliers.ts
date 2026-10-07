// Which Suppliers are configured (gh#342): drives which verbs a row offers.
// "get" is a SoundCloud download — never offered without SoundCloud (the
// task would sit pending forever); Soulseek verbs need slskd.
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { SUPPLIERS_KEY } from './useAcquisitionAvailable';

export function useSuppliers(): { soundcloud: boolean; soulseek: boolean } {
  const { data } = useQuery({
    queryKey: SUPPLIERS_KEY,
    queryFn: api.acquisition.getSuppliers,
    staleTime: 5 * 60 * 1000,
  });
  const ids = new Set((data ?? []).map(s => s.id));
  return { soundcloud: ids.has('soundcloud'), soulseek: ids.has('soulseek') };
}
