import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function isKeyboardHelpOpen(): boolean {
  return open;
}

export function setKeyboardHelpOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  notify();
}

export function openKeyboardHelp(): void {
  setKeyboardHelpOpen(true);
}

export function subscribeKeyboardHelp(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useKeyboardHelpOpen(): boolean {
  return useSyncExternalStore(subscribeKeyboardHelp, isKeyboardHelpOpen);
}

export function _resetKeyboardHelpForTests(): void {
  open = false;
  listeners.clear();
}
