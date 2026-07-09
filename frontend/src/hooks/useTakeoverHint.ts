import { useSyncExternalStore } from 'react';
import {
  subscribeTakeoverHints,
  takeoverHint,
  type TakeoverDirection,
} from '../midi/takeoverFeedback';

/**
 * Subscribe to a control's soft-takeover hint (midi-controller 18): the
 * direction the hardware must move to pick up, or null when latched /
 * idle. Keys come from takeoverKey (midi/takeoverFeedback.ts).
 */
export function useTakeoverHint(key: string): TakeoverDirection | null {
  return useSyncExternalStore(subscribeTakeoverHints, () => takeoverHint(key));
}
