export interface PointerPoint {
  x: number;
  y: number;
}

export interface CursorSuppressionState {
  hidden: boolean;
  lastPointer: PointerPoint | null;
  hideAnchor: PointerPoint | null;
}

export const POINTER_WAKE_DISTANCE_PX = 4;

export const initialCursorSuppressionState: CursorSuppressionState = {
  hidden: false,
  lastPointer: null,
  hideAnchor: null,
};

export function hideCursorForMidi(state: CursorSuppressionState): CursorSuppressionState {
  return {
    ...state,
    hidden: true,
    hideAnchor: state.lastPointer,
  };
}

export function revealCursor(state: CursorSuppressionState): CursorSuppressionState {
  return { ...state, hidden: false, hideAnchor: null };
}

export function pointerMoved(
  state: CursorSuppressionState,
  point: PointerPoint
): CursorSuppressionState {
  if (!state.hidden) return { ...state, lastPointer: point };

  if (!state.hideAnchor) {
    return { hidden: false, lastPointer: point, hideAnchor: null };
  }

  const anchor = state.hideAnchor ?? point;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const intentional = dx * dx + dy * dy >= POINTER_WAKE_DISTANCE_PX * POINTER_WAKE_DISTANCE_PX;

  return {
    hidden: !intentional,
    lastPointer: point,
    hideAnchor: intentional ? null : anchor,
  };
}
