import { describe, expect, it } from 'vitest';
import { settingDiff } from './DeviceChangeLog';

describe('settingDiff', () => {
  it('lists changed leaves', () => {
    expect(settingDiff({ model: 'res24', resonance: 10 }, { model: 'res24', resonance: 12 })).toBe('resonance 10 → 12');
    expect(settingDiff({ full: { params: { master: 1 } } }, { full: { params: { master: 2 } } })).toBe(
      'full.params.master 1 → 2',
    );
    expect(settingDiff({ a: 1 }, { a: 1 })).toBe('no change');
  });
});
