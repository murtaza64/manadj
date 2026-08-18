/** Replay follow-scroll math (sessions 17). */
import { describe, expect, it } from 'vitest';
import { FOLLOW_ZONE, followScrollTarget } from './followScroll';

describe('followScrollTarget', () => {
  // viewport 1000px wide over 5000px of content → zone edge at 800.
  const W = 1000;
  const TOTAL = 5000;

  it('a head in the free 80% never scrolls', () => {
    expect(followScrollTarget(0, 0, W, TOTAL)).toBeNull();
    expect(followScrollTarget(799, 0, W, TOTAL)).toBeNull();
    expect(followScrollTarget(1800, 1000, W, TOTAL)).toBeNull(); // 80% at 1800
  });

  it('a head past the zone edge pins the viewport to it', () => {
    // Head at 801: viewport moves so the head sits AT the 80% mark.
    expect(followScrollTarget(801, 0, W, TOTAL)).toBeCloseTo(801 - FOLLOW_ZONE * W, 6);
    // Steady advance = steady scroll: each px of head = one px of scroll.
    const a = followScrollTarget(1050, 200, W, TOTAL)!;
    expect(a).toBeCloseTo(250, 6);
    const b = followScrollTarget(1051, a, W, TOTAL)!;
    expect(b - a).toBeCloseTo(1, 6);
  });

  it('clamps at the end of the scrollable area', () => {
    // maxScroll = 4000; a head near the end pins no further than that.
    expect(followScrollTarget(4990, 3900, W, TOTAL)).toBe(4000);
    // Already at the end: nothing to do.
    expect(followScrollTarget(4990, 4000, W, TOTAL)).toBeNull();
  });

  it('never scrolls backwards (a seek back into view leaves the viewport)', () => {
    // Head behind the zone edge relative to current scroll → null even
    // though it is far into absolute content.
    expect(followScrollTarget(2000, 1500, W, TOTAL)).toBeNull();
  });

  it('no scrollable area (fit zoom) never scrolls', () => {
    expect(followScrollTarget(900, 0, W, 1000)).toBeNull();
  });
});
