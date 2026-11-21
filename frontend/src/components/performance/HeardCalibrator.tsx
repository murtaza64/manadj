/**
 * Heard calibration popover (#510): the route's output-latency control as
 * a small anchored, non-modal popover at the mixer's HEARD chip — the
 * performer calibrates while mixing: no Settings detour, no dialog, no
 * keyboard capture (deck keys and Space keep playing). A click outside
 * the HEARD cluster or Escape closes it; values write through heardStore
 * per route, so the next set on the same output keeps the calibration.
 */
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import {
  HEARD_LATENCY_STEP_SECONDS,
  heardRoute,
  nudgeRouteLatency,
  setRouteLatency,
  subscribeHeard,
} from '../../playback/heardStore';

export function HeardCalibrator({ anchorRef, onClose }: {
  /** The HEARD cluster (chip + this popover) — clicks inside don't close. */
  anchorRef: RefObject<HTMLSpanElement | null>;
  onClose: () => void;
}) {
  const route = useSyncExternalStore(subscribeHeard, heardRoute);
  const ms = Math.round(route.seconds * 1000);
  const reported = Math.round(route.reportedSeconds * 1000);

  // Outside pointerdown and Escape close. Bubble phase on purpose: deck
  // keys keep their capture-phase handlers, and a real modal opening on
  // top wins over this listener.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onClose]);

  return (
    <div className="perf-heardpop" role="dialog" aria-label="Heard calibration">
      <span className="perf-heardpop-route" title={route.label}>{route.label}</span>
      <span className="perf-heardpop-row">
        <button
          className="player-button perf-heardpop-step"
          aria-label="Less output latency"
          onClick={() => nudgeRouteLatency(-HEARD_LATENCY_STEP_SECONDS)}
        >
          −
        </button>
        <span className="perf-heardpop-ms">{ms}ms</span>
        <button
          className="player-button perf-heardpop-step"
          aria-label="More output latency"
          onClick={() => nudgeRouteLatency(HEARD_LATENCY_STEP_SECONDS)}
        >
          +
        </button>
      </span>
      <span className="perf-heardpop-note">
        {route.overridden ? `reported ${reported}ms` : 'device-reported'}
      </span>
      {route.overridden && (
        <button
          className="player-button perf-heardpop-reset"
          onClick={() => setRouteLatency(null)}
        >
          Use reported
        </button>
      )}
    </div>
  );
}
