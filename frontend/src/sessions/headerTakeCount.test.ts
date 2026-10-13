import { describe, expect, it } from 'vitest';
import { headerTakeCount } from './headerTakeCount';

describe('headerTakeCount (gh#329)', () => {
  it('uses the Session row take_count while the Take list is loading', () => {
    expect(headerTakeCount(undefined, 116)).toBe(116);
  });

  it('uses the loaded per-session Take list once present', () => {
    expect(headerTakeCount([{}, {}, {}], 116)).toBe(3);
    expect(headerTakeCount([], 116)).toBe(0);
  });
});
