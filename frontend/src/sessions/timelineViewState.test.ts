/** Per-Session shared timeline view state (sessions 21). */
import { describe, expect, it } from 'vitest';
import {
  getTimelineViewState,
  patchTimelineViewState,
  saveTimelineViewState,
} from './timelineViewState';

describe('timelineViewState', () => {
  it('round-trips per uuid; unknown uuids are null', () => {
    expect(getTimelineViewState('nope')).toBeNull();
    const state = {
      pxPerSec: 4.2,
      centerT: 1234.5,
      collapseIdle: false,
      thresholdS: 120,
      expandedGaps: [1, 3],
      showTraces: false,
    };
    saveTimelineViewState('u1', state);
    expect(getTimelineViewState('u1')).toEqual(state);
  });

  it('patch merges over defaults and prior state (two instances write-through)', () => {
    patchTimelineViewState('u3', { pxPerSec: 2 });
    expect(getTimelineViewState('u3')).toMatchObject({
      pxPerSec: 2,
      collapseIdle: true, // defaults fill the rest
      thresholdS: 45,
    });
    patchTimelineViewState('u3', { centerT: 99 }); // the OTHER instance
    expect(getTimelineViewState('u3')).toMatchObject({ pxPerSec: 2, centerT: 99 });
  });

  it('sessions do not share state', () => {
    patchTimelineViewState('a', { pxPerSec: 1 });
    patchTimelineViewState('b', { pxPerSec: 9 });
    expect(getTimelineViewState('a')!.pxPerSec).toBe(1);
    expect(getTimelineViewState('b')!.pxPerSec).toBe(9);
  });
});
