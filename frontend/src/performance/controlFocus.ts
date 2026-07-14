import { useSyncExternalStore } from 'react';
import type { ChannelId } from '../playback/mixer';

export type ControlSide = 'left' | 'right';
export interface ControlFocus {
  left: 'A' | 'C';
  right: 'B' | 'D';
}

let focus: ControlFocus = { left: 'A', right: 'B' };
const listeners = new Set<() => void>();

export function getControlFocus(): ControlFocus {
  return focus;
}

export function subscribeControlFocus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function focusDeck(deck: ChannelId): void {
  const next: ControlFocus =
    deck === 'A' || deck === 'C' ? { ...focus, left: deck } : { ...focus, right: deck };
  if (next.left === focus.left && next.right === focus.right) return;
  focus = next;
  for (const listener of listeners) listener();
}

export function toggleControlFocus(side: ControlSide): void {
  focus =
    side === 'left'
      ? { ...focus, left: focus.left === 'A' ? 'C' : 'A' }
      : { ...focus, right: focus.right === 'B' ? 'D' : 'B' };
  for (const listener of listeners) listener();
}

export function useControlFocus(): ControlFocus {
  return useSyncExternalStore(subscribeControlFocus, getControlFocus);
}

export function _resetControlFocusForTests(): void {
  focus = { left: 'A', right: 'B' };
  for (const listener of listeners) listener();
}
