/**
 * Per-Session timeline view state (sessions 21) — the cross-INSTANCE sync
 * layer over keep-alive views (perf-layout 09): the standalone Library and
 * the Performance-embedded one are separate component instances by design
 * (the embedded one carries load-lock/deck-targeting props), so keeping
 * them mounted is not enough — zoom/scroll must converge through a shared
 * store. Instances WRITE THROUGH on every change and ADOPT on view
 * activation; keyed by session uuid so state never leaks between
 * Sessions. In-memory by design: an app restart is a fresh look.
 */

export interface TimelineViewState {
  /** Zoom (null = fit). */
  pxPerSec: number | null;
  /** Viewport center, capture-clock seconds — stable across zoom/width
   * changes, unlike a raw scrollLeft. Null = never scrolled. */
  centerT: number | null;
  collapseIdle: boolean;
  thresholdS: number;
  /** Expanded collapse-candidate indices (Set serialized). */
  expandedGaps: number[];
  showTraces: boolean;
}

const states = new Map<string, TimelineViewState>();

export function getTimelineViewState(uuid: string): TimelineViewState | null {
  return states.get(uuid) ?? null;
}

export function saveTimelineViewState(uuid: string, state: TimelineViewState): void {
  states.set(uuid, state);
}

/** Partial write-through (an instance updating just what changed). */
export function patchTimelineViewState(uuid: string, patch: Partial<TimelineViewState>): void {
  const prev = states.get(uuid) ?? {
    pxPerSec: null,
    centerT: null,
    collapseIdle: true,
    thresholdS: 45,
    expandedGaps: [],
    showTraces: true,
  };
  states.set(uuid, { ...prev, ...patch });
}
