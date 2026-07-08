import { describe, expect, it } from 'vitest';
import {
  hideCursorForMidi,
  initialCursorSuppressionState,
  pointerMoved,
  revealCursor,
} from './cursorSuppression';

describe('cursor suppression during MIDI operation', () => {
  it('MIDI activity hides from the current pointer position', () => {
    const tracked = pointerMoved(initialCursorSuppressionState, { x: 100, y: 100 });
    const hidden = hideCursorForMidi(tracked);

    expect(hidden.hidden).toBe(true);
    expect(hidden.hideAnchor).toEqual({ x: 100, y: 100 });
  });

  it('tiny pointer jitter during MIDI operation keeps the cursor hidden', () => {
    const hidden = hideCursorForMidi(
      pointerMoved(initialCursorSuppressionState, { x: 100, y: 100 })
    );

    const jittered = pointerMoved(hidden, { x: 102, y: 101 });

    expect(jittered.hidden).toBe(true);
    expect(jittered.hideAnchor).toEqual({ x: 100, y: 100 });
  });

  it('intentional pointer movement restores the cursor', () => {
    const hidden = hideCursorForMidi(
      pointerMoved(initialCursorSuppressionState, { x: 100, y: 100 })
    );

    const moved = pointerMoved(hidden, { x: 104, y: 100 });

    expect(moved.hidden).toBe(false);
    expect(moved.hideAnchor).toBeNull();
  });

  it('first pointer movement restores the cursor when MIDI hid before any pointer anchor was known', () => {
    const hidden = hideCursorForMidi(initialCursorSuppressionState);

    const moved = pointerMoved(hidden, { x: 100, y: 100 });

    expect(moved.hidden).toBe(false);
    expect(moved.hideAnchor).toBeNull();
  });

  it('click-like pointer interaction restores the cursor', () => {
    const hidden = hideCursorForMidi(initialCursorSuppressionState);

    expect(revealCursor(hidden).hidden).toBe(false);
  });
});
