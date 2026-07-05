/**
 * Loop overlay model (looping 05): the played-dim boundary under regions
 * (minimap-clarity verdict — a loop the playhead is inside never reads as
 * "already heard").
 */
import { describe, expect, it } from 'vitest';
import { loopOverlayRegions, playedDimBoundary } from './loopOverlay';

describe('playedDimBoundary', () => {
  const regions = [{ start: 10, end: 12 }];

  it('stops the dim at the region left edge while the playhead is inside', () => {
    expect(playedDimBoundary(11.5, regions)).toBe(10);
    expect(playedDimBoundary(10, regions)).toBe(10);
  });

  it('follows the playhead outside the region', () => {
    expect(playedDimBoundary(9.5, regions)).toBe(9.5);
    expect(playedDimBoundary(12, regions)).toBe(12); // past the end: released
    expect(playedDimBoundary(30, regions)).toBe(30);
  });

  it('follows the playhead with no regions', () => {
    expect(playedDimBoundary(42, [])).toBe(42);
    expect(playedDimBoundary(42, loopOverlayRegions(null))).toBe(42);
  });

  it('works on the loop mapping directly', () => {
    const regions = loopOverlayRegions({ start: 10, end: 12, lengthBeats: 4 });
    expect(playedDimBoundary(11, regions)).toBe(10);
  });
});
