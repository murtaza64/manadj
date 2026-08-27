/**
 * Cameo pin reconciliation (#140): the entry-ornament sibling of
 * dormancy's reconcileOrderChange — host-membership keyed, order-blind.
 */
import { describe, expect, it } from 'vitest';
import { reconcileCameoOrderChange } from './cameoPins';
import type { CameoPin, DormantCameoPin } from './cameoPins';

const pin = (uuid: string, kind: CameoPin['kind'] = 'cameo'): CameoPin => ({ kind, uuid });

describe('reconcileCameoOrderChange', () => {
  it('reordering never touches Cameo pins (PRD story 15)', () => {
    const entries = [
      { trackId: 1, cameoPins: [pin('c1'), pin('t1', 'cameo-take')] },
      { trackId: 2 },
      { trackId: 3, cameoPins: [pin('c2')] },
    ];
    const { cameoPinsByHost, dormant } = reconcileCameoOrderChange(entries, [], [3, 1, 2]);
    expect(cameoPinsByHost.get(1)).toEqual([pin('c1'), pin('t1', 'cameo-take')]);
    expect(cameoPinsByHost.get(3)).toEqual([pin('c2')]);
    expect(dormant).toEqual([]);
  });

  it('a removed host sends its pins Dormant, keyed on the host', () => {
    const entries = [{ trackId: 1, cameoPins: [pin('c1')] }, { trackId: 2 }];
    const { cameoPinsByHost, dormant } = reconcileCameoOrderChange(entries, [], [2]);
    expect(cameoPinsByHost.has(1)).toBe(false);
    expect(dormant).toEqual([{ hostTrackId: 1, pin: pin('c1') }]);
  });

  it('a returning host restores its memory, in pin order', () => {
    const dormantIn: DormantCameoPin[] = [
      { hostTrackId: 1, pin: pin('c1') },
      { hostTrackId: 1, pin: pin('t1', 'cameo-take') },
    ];
    const { cameoPinsByHost, dormant } = reconcileCameoOrderChange(
      [{ trackId: 2 }],
      dormantIn,
      [2, 1]
    );
    expect(cameoPinsByHost.get(1)).toEqual([pin('c1'), pin('t1', 'cameo-take')]);
    expect(dormant).toEqual([]);
  });

  it('memories of still-absent hosts survive untouched', () => {
    const dormantIn: DormantCameoPin[] = [{ hostTrackId: 9, pin: pin('c9') }];
    const { dormant } = reconcileCameoOrderChange([{ trackId: 1 }], dormantIn, [1]);
    expect(dormant).toEqual(dormantIn);
  });

  it('dormancy is per-host: one host leaving never disturbs another', () => {
    const entries = [
      { trackId: 1, cameoPins: [pin('c1')] },
      { trackId: 2, cameoPins: [pin('c2')] },
    ];
    const { cameoPinsByHost, dormant } = reconcileCameoOrderChange(entries, [], [2]);
    expect(cameoPinsByHost.get(2)).toEqual([pin('c2')]);
    expect(dormant).toEqual([{ hostTrackId: 1, pin: pin('c1') }]);
  });
});
