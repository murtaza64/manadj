/** App configuration (packaged-app #277): the settings file, served by
 * /api/config. Distinct from persistedSettings (DB-backed UI preferences).
 *
 * `useExportEnabled` gates every Rekordbox/Engine WRITE surface (ADR 0043):
 * until the config loads, export UI stays hidden (default-off posture).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AppConfigUpdateWire, type AppConfigWire } from '../api/client';

export const APP_CONFIG_QUERY_KEY = ['app-config'] as const;

export function useAppConfig() {
  return useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: api.appConfig.get,
    staleTime: 30_000,
  });
}

export function useExportEnabled(): boolean {
  const { data } = useAppConfig();
  return data?.export_enabled ?? false;
}

export function useUpdateAppConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: AppConfigUpdateWire) => api.appConfig.update(changes),
    onSuccess: (data: AppConfigWire) => {
      queryClient.setQueryData(APP_CONFIG_QUERY_KEY, data);
    },
  });
}
