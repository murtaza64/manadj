/**
 * THE React Query client (sets 13): module-scoped so non-React modules —
 * the capture sink foremost — can invalidate queries at the moment data
 * changes, instead of every consumer wiring its own window-event listener.
 * App provides this same instance via QueryClientProvider.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();
