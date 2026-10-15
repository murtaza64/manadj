import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { subscribeMidiActivity } from '../midi/activity';
import {
  hideCursorForMidi,
  initialCursorSuppressionState,
  pointerMoved,
  revealCursor,
} from './cursorSuppression';
import type { CursorSuppressionState } from './cursorSuppression';

const NORMAL_CURSOR_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[data-cursor-normal]',
].join(',');

const HIDDEN_CLASS = 'midi-cursor-hidden';

/** The element carrying HIDDEN_CLASS: the app surface (.app-main) that
 * the suppression blankets, or the view root outside the app shell. A
 * class on the scope itself, not `.app-main:has(.perf-root.…)`: that
 * selector made every DOM insertion under .app-main recalc the whole
 * subtree's style (~1.8k elements, 35-60 ms per library scroll step;
 * desktop-perf #385). */
function scopeOf(root: HTMLElement | null): HTMLElement | null {
  return (root?.closest('.app-main') as HTMLElement | null) ?? root;
}

function keepsNormalCursor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NORMAL_CURSOR_SELECTOR) !== null;
}

/** Performance-view-only cursor policy: controller activity hides; intent
 * restores. `enabled` gates the whole policy — the keep-alive Performance
 * view stays mounted while hidden, and since the suppression now blankets
 * the app surface (gh#165), a hidden view must never arm it. */
export function useMidiCursorSuppression(
  rootRef: RefObject<HTMLElement | null>,
  enabled = true
): void {
  const stateRef = useRef<CursorSuppressionState>(initialCursorSuppressionState);

  useEffect(() => {
    if (!enabled) return;
    const hide = () => scopeOf(rootRef.current)?.classList.add(HIDDEN_CLASS);

    return subscribeMidiActivity(() => {
      if (keepsNormalCursor(document.activeElement)) return;
      stateRef.current = hideCursorForMidi(stateRef.current);
      hide();
    });
  }, [rootRef, enabled]);

  useEffect(() => {
    if (!enabled) return;
    // Captured: the root ref is already detached when unmount cleanup runs.
    const mountedScope = scopeOf(rootRef.current);
    const revealNow = () => {
      stateRef.current = revealCursor(stateRef.current);
      scopeOf(rootRef.current)?.classList.remove(HIDDEN_CLASS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (keepsNormalCursor(event.target)) {
        revealNow();
        return;
      }
      const next = pointerMoved(stateRef.current, { x: event.clientX, y: event.clientY });
      stateRef.current = next;
      if (!next.hidden) scopeOf(rootRef.current)?.classList.remove(HIDDEN_CLASS);
    };

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', revealNow, { capture: true });
    document.addEventListener('wheel', revealNow, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', revealNow, { capture: true });
      document.removeEventListener('wheel', revealNow, { capture: true });
      (scopeOf(rootRef.current) ?? mountedScope)?.classList.remove(HIDDEN_CLASS);
      stateRef.current = initialCursorSuppressionState;
    };
  }, [rootRef, enabled]);
}
