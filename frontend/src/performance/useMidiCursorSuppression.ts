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

function keepsNormalCursor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NORMAL_CURSOR_SELECTOR) !== null;
}

/** Performance-view-only cursor policy: controller activity hides; intent restores. */
export function useMidiCursorSuppression(rootRef: RefObject<HTMLElement | null>): void {
  const stateRef = useRef<CursorSuppressionState>(initialCursorSuppressionState);

  useEffect(() => {
    const hide = () => rootRef.current?.classList.add(HIDDEN_CLASS);

    return subscribeMidiActivity(() => {
      if (keepsNormalCursor(document.activeElement)) return;
      stateRef.current = hideCursorForMidi(stateRef.current);
      hide();
    });
  }, [rootRef]);

  useEffect(() => {
    const revealNow = () => {
      stateRef.current = revealCursor(stateRef.current);
      rootRef.current?.classList.remove(HIDDEN_CLASS);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (keepsNormalCursor(event.target)) {
        revealNow();
        return;
      }
      const next = pointerMoved(stateRef.current, { x: event.clientX, y: event.clientY });
      stateRef.current = next;
      if (!next.hidden) rootRef.current?.classList.remove(HIDDEN_CLASS);
    };

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', revealNow, { capture: true });
    document.addEventListener('wheel', revealNow, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', revealNow, { capture: true });
      document.removeEventListener('wheel', revealNow, { capture: true });
      rootRef.current?.classList.remove(HIDDEN_CLASS);
      stateRef.current = initialCursorSuppressionState;
    };
  }, [rootRef]);
}
