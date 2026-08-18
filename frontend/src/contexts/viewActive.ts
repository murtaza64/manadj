/**
 * View-activity context (perf-layout 09): keep-alive mode views stay
 * mounted while hidden; loops that should sleep (replay playhead rAF,
 * pollers) gate on `useViewActive()`. Defaults to true so components
 * outside a KeepAliveView behave exactly as before.
 */
import { createContext, useContext } from 'react';

export const ViewActiveContext = createContext(true);

/** Is the enclosing mode view currently the visible one? */
export function useViewActive(): boolean {
  return useContext(ViewActiveContext);
}
