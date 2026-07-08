/**
 * Live Conductor playhead over the loaded transition (sets 38).
 *
 * While a Set plays through the pair loaded in the editor, one vertical
 * marker across the lane stack shows WHERE the set currently is —
 * live-editing a sounding adjacency (the sets 24 loop) gets a truthful
 * "you are here". It tracks the whole pair (park-review feedback): the
 * outgoing's solo leads up to the window, the window maps on the
 * authored axis, and the incoming's tail carries it out.
 *
 * Match + mapping are the pure seam (replan.ts authoredPlayheadAt): the
 * executed plan's adjacency is matched by pin uuid against the editor's
 * active transition, and the marker lives on the AUTHORED axis computed
 * from the EXECUTED adjacency's geometry — during a deferred geometry
 * edit the editor draws the NEW window while the Conductor executes the
 * OLD, and the marker stays truthful to what is heard. A re-pin
 * mid-window grafts under GRAFT_PIN_UUID, so the marker correctly
 * disappears.
 *
 * Refresh is a self-owned rAF loop OUTSIDE React (playheads move
 * continuously): transform/display writes only, the existing mix
 * playhead's idiom (a layout-property write per frame is the
 * library-mode jitter disease — DawTimeline issue 10). The timeline
 * content is scroll-transformed as a whole, so content-space px need no
 * scroll term.
 */
import { useEffect, useRef } from 'react';
import { getConductor } from '../sets/conductorStore';
import { authoredPlayheadAt } from '../sets/replan';
import { useEditorSelector, type EditorStore } from './editorStore';

const IDLE_TICK_MS = 250;

export function ConductorLanePlayhead({
  store,
  pxPerSec,
}: {
  store: EditorStore;
  pxPerSec: number;
}): React.ReactElement {
  // The uuid the plan would pin for what the editor shows: the active
  // SavedTransition's uuid — or, under take review (transition-takes 03),
  // the TAKE's uuid: the session item is a fresh draft, but a take pin
  // plans the same idealized vectorization the review displays, so the
  // marker is truthful against the take uuid.
  const activeUuid = useEditorSelector(store, (s) => {
    const item = s.session.items[s.session.active];
    if (!item) return null;
    return s.takeDraft?.itemUuid === item.uuid ? s.takeDraft.takeUuid : item.uuid;
  });
  const ref = useRef<HTMLDivElement>(null);
  // The loop reads inputs through a ref: zoom re-renders (flushSync, per
  // frame while wheeling) must not rebuild the rAF chain.
  const inputs = useRef({ activeUuid, pxPerSec });
  useEffect(() => {
    inputs.current = { activeUuid, pxPerSec };
  });
  useEffect(() => {
    let raf = 0;
    let idleTimer = 0;
    const schedule = (active: boolean) => {
      if (active) raf = requestAnimationFrame(tick);
      else idleTimer = window.setTimeout(tick, IDLE_TICK_MS);
    };
    const tick = () => {
      const el = ref.current;
      if (!el) {
        schedule(false);
        return;
      }
      const { activeUuid, pxPerSec } = inputs.current;
      const conductor = getConductor();
      const active = conductor !== null && conductor.isActive();
      const authored =
        conductor !== null && active && activeUuid !== null
          ? authoredPlayheadAt(conductor.plan, conductor.getMixTime(), activeUuid)
          : null;
      if (authored === null) {
        el.style.display = 'none';
        schedule(active);
        return;
      }
      el.style.display = '';
      el.style.transform = `translateX(${authored * pxPerSec}px)`;
      schedule(true);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
    };
  }, []);
  return (
    <div ref={ref} className="editor-conductor-playhead" style={{ display: 'none' }} />
  );
}
