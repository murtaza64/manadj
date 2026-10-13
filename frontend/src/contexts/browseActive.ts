import { createContext, useContext } from 'react';

export const BrowseActiveContext = createContext(true);

/** Is lower-panel browsing available? Deck controls remain active in Settings. */
export function useBrowseActive(): boolean {
  return useContext(BrowseActiveContext);
}
