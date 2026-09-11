import { useEffect, useEffectEvent, useState, type RefObject } from 'react';
import { isTrackDrag } from '../selection/trackDrag';
import { dragEdgeScrollDelta, DRAG_POINTER_STALE_MS } from './dragScroll';

/** Keep scrolling under a stationary HTML5 drag, including vertical overshoot. */
export function useDragEdgeScroll(
  paneRef: RefObject<HTMLDivElement | null>,
  onScroll: (clientY: number) => void,
  onEnd: () => void,
): boolean {
  const [scrolling, setScrolling] = useState(false);
  const updateTarget = useEffectEvent(onScroll);
  const endDrag = useEffectEvent(onEnd);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    let pointer: { x: number; y: number; at: number } | null = null;
    let localDrag = false;
    let raf = 0;
    let previous = 0;
    let position = pane.scrollTop;
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      pointer = null;
      localDrag = false;
      setScrolling(false);
    };
    const finish = () => {
      if (!pointer && !localDrag) return;
      stop();
      endDrag();
    };
    const frame = (now: number) => {
      raf = 0;
      if (!pointer) return;
      // Internal drags have a reliable dragend/blur lifecycle. Chromium may
      // stop sending dragover entirely while the pointer is held still.
      if (!localDrag && now - pointer.at > DRAG_POINTER_STALE_MS) {
        finish();
        return;
      }
      const rect = pane.getBoundingClientRect();
      // Set rows include an adjacency row: twice the playlist-row scroll speed.
      const delta = pointer.x >= rect.left && pointer.x <= rect.right
        ? 2 * dragEdgeScrollDelta(pointer.y, rect.top, rect.bottom, now - previous)
        : 0;
      previous = now;
      const before = pane.scrollTop;
      const max = pane.scrollHeight - pane.clientHeight;
      // Retain fractional pixels instead of rounding every frame (especially
      // noticeable at high refresh rates and near the edge-zone boundary).
      if (Math.abs(before - position) > 1) position = before;
      if (delta !== 0) {
        position = Math.max(0, Math.min(max, position + delta));
        pane.scrollTop = position;
      }
      const moved = pane.scrollTop !== before;
      setScrolling(delta < 0 ? before > 0 : delta > 0 && before < max);
      if (moved) updateTarget(Math.max(rect.top, Math.min(rect.bottom, pointer.y)));
      raf = requestAnimationFrame(frame);
    };
    const trackPointer = (event: DragEvent) => {
      if (!event.dataTransfer || !isTrackDrag(event.dataTransfer)) return;
      if (!pointer && !(event.target instanceof Node && pane.contains(event.target))) return;
      const now = performance.now();
      pointer = { x: event.clientX, y: event.clientY, at: now };
      if (!raf) {
        previous = now;
        raf = requestAnimationFrame(frame);
      }
    };
    const start = (event: DragEvent) => {
      localDrag = event.target instanceof Node && pane.contains(event.target) &&
        event.dataTransfer !== null && isTrackDrag(event.dataTransfer);
    };
    window.addEventListener('dragstart', start);
    window.addEventListener('dragenter', trackPointer);
    window.addEventListener('dragover', trackPointer);
    window.addEventListener('drop', finish);
    window.addEventListener('dragend', finish);
    window.addEventListener('blur', finish);
    return () => {
      stop();
      window.removeEventListener('dragstart', start);
      window.removeEventListener('dragenter', trackPointer);
      window.removeEventListener('dragover', trackPointer);
      window.removeEventListener('drop', finish);
      window.removeEventListener('dragend', finish);
      window.removeEventListener('blur', finish);
    };
  }, [paneRef]);
  return scrolling;
}
