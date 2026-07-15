/**
 * Routing resolution (headphone-cue 01): the pure seam between saved device
 * choices and the sinks the audio layer applies. Master must never go
 * silent; the Cue bus degrades to disabled.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTING_PREFS,
  cueChannelPair,
  outputPairOptions,
  parseRoutingPrefs,
  planOutput,
  resolveRouting,
  sameOutputChoice,
} from './routing';
import type { RoutingPrefs } from './routing';

const MAC = { deviceId: 'mac-speakers', label: 'MacBook Pro Speakers' };
const INPULSE = { deviceId: 'inpulse-34', label: 'DJControl Inpulse 300 MK2' };
const GRV6 = { deviceId: 'grv6', label: 'AlphaTheta DDJ-GRV6' };
const MAC_OUTPUT = { ...MAC, maxChannelCount: 2 };
const INPULSE_OUTPUT = { ...INPULSE, maxChannelCount: 4 };
const GRV6_OUTPUT = { ...GRV6, maxChannelCount: 8 };

const prefs = (p: Partial<RoutingPrefs>): RoutingPrefs => ({
  ...DEFAULT_ROUTING_PREFS,
  ...p,
});

describe('resolveRouting', () => {
  it('nothing saved: master on the system default, cue disabled, nothing missing', () => {
    expect(resolveRouting(DEFAULT_ROUTING_PREFS, [MAC_OUTPUT])).toEqual({
      masterSinkId: null,
      masterPair: null,
      masterMissing: false,
      cueSinkId: null,
      cuePair: null,
      cueMissing: false,
      masterNeedsPair: false,
      cueNeedsPair: false,
    });
  });

  it('saved devices present: both buses get their saved sinks', () => {
    const resolved = resolveRouting(prefs({ master: MAC, cue: INPULSE }), [MAC_OUTPUT, INPULSE_OUTPUT]);
    expect(resolved.masterSinkId).toBe(MAC.deviceId);
    expect(resolved.masterPair).toBeNull();
    expect(resolved.cueSinkId).toBe(INPULSE.deviceId);
    expect(resolved.cuePair).toEqual({ left: 2, right: 3 });
    expect(resolved.masterMissing).toBe(false);
    expect(resolved.cueMissing).toBe(false);
  });

  it('a saved cue pair rides through resolution', () => {
    const resolved = resolveRouting(
      prefs({ cue: { ...INPULSE, pair: { left: 2, right: 3 } } }),
      [INPULSE_OUTPUT]
    );
    expect(resolved.cueSinkId).toBe(INPULSE.deviceId);
    expect(resolved.cuePair).toEqual({ left: 2, right: 3 });
  });

  it('a saved master pair rides through resolution', () => {
    const resolved = resolveRouting(
      prefs({ master: { ...INPULSE, pair: { left: 2, right: 3 } } }),
      [INPULSE_OUTPUT]
    );
    expect(resolved.masterSinkId).toBe(INPULSE.deviceId);
    expect(resolved.masterPair).toEqual({ left: 2, right: 3 });
  });

  it('saved master missing: falls back to the system default and says so', () => {
    const resolved = resolveRouting(prefs({ master: INPULSE }), [MAC_OUTPUT]);
    expect(resolved.masterSinkId).toBeNull();
    expect(resolved.masterPair).toBeNull();
    expect(resolved.masterMissing).toBe(true);
  });

  it('saved cue device missing: cue disabled and flagged, master untouched', () => {
    const resolved = resolveRouting(prefs({ master: MAC, cue: INPULSE }), [MAC_OUTPUT]);
    expect(resolved.masterSinkId).toBe(MAC.deviceId);
    expect(resolved.masterMissing).toBe(false);
    expect(resolved.cueSinkId).toBeNull();
    expect(resolved.cuePair).toBeNull();
    expect(resolved.cueMissing).toBe(true);
  });

  it('no cue saved is not "missing" — just off', () => {
    const resolved = resolveRouting(prefs({ master: MAC }), [MAC_OUTPUT]);
    expect(resolved.cueSinkId).toBeNull();
    expect(resolved.cueMissing).toBe(false);
  });

  it('master and cue may share a device (single-interface setups)', () => {
    const resolved = resolveRouting(prefs({ master: INPULSE, cue: INPULSE }), [INPULSE_OUTPUT]);
    expect(resolved.masterSinkId).toBe(INPULSE.deviceId);
    expect(resolved.cueSinkId).toBe(INPULSE.deviceId);
  });

  it('everything unplugged: master default, cue disabled, both flagged', () => {
    const resolved = resolveRouting(prefs({ master: MAC, cue: INPULSE }), []);
    expect(resolved).toEqual({
      masterSinkId: null,
      masterPair: null,
      masterMissing: true,
      cueSinkId: null,
      cuePair: null,
      cueMissing: true,
      masterNeedsPair: false,
      cueNeedsPair: false,
    });
  });

  it('recognizes an unverified GRV6 but requires explicit pairs instead of guessing', () => {
    const resolved = resolveRouting(prefs({ master: GRV6, cue: GRV6 }), [GRV6_OUTPUT]);
    expect(resolved).toEqual({
      masterSinkId: null,
      masterPair: null,
      masterMissing: false,
      masterNeedsPair: true,
      cueSinkId: null,
      cuePair: null,
      cueMissing: false,
      cueNeedsPair: true,
    });
  });

  it('routes explicit GRV6 pairs independently and restores them after replug', () => {
    const saved = prefs({
      master: { ...GRV6, pair: { left: 0, right: 1 } },
      cue: { ...GRV6, pair: { left: 6, right: 7 } },
    });
    const plugged = resolveRouting(saved, [GRV6_OUTPUT]);
    expect(plugged.masterPair).toEqual({ left: 0, right: 1 });
    expect(plugged.cuePair).toEqual({ left: 6, right: 7 });

    const unplugged = resolveRouting(saved, []);
    expect(unplugged.masterSinkId).toBeNull();
    expect(unplugged.cueSinkId).toBeNull();
    expect(unplugged.masterMissing).toBe(true);
    expect(unplugged.cueMissing).toBe(true);

    expect(resolveRouting(saved, [GRV6_OUTPUT])).toEqual(plugged);
  });

  it('losing a separate Cue device leaves the Master route intact', () => {
    const saved = prefs({
      master: MAC,
      cue: { ...GRV6, pair: { left: 2, right: 3 } },
    });
    const resolved = resolveRouting(saved, [MAC_OUTPUT]);
    expect(resolved.masterSinkId).toBe(MAC.deviceId);
    expect(resolved.masterMissing).toBe(false);
    expect(resolved.cueSinkId).toBeNull();
    expect(resolved.cueMissing).toBe(true);
  });
});

describe('outputPairOptions (explicit output pairs)', () => {
  const stereo = { ...MAC, maxChannelCount: 2 };
  const fourOut = { ...INPULSE, maxChannelCount: 4 };

  it('a stereo device is one plain entry', () => {
    expect(outputPairOptions([stereo])).toEqual([
      { deviceId: MAC.deviceId, label: MAC.label, pair: null },
    ]);
  });

  it('a 4-out interface splits into two 1-based-labelled pairs', () => {
    expect(outputPairOptions([fourOut])).toEqual([
      { deviceId: INPULSE.deviceId, label: `${INPULSE.label} (outs 1/2)`, pair: { left: 0, right: 1 } },
      { deviceId: INPULSE.deviceId, label: `${INPULSE.label} (outs 3/4)`, pair: { left: 2, right: 3 } },
    ]);
  });

  it('bigger interfaces get one entry per pair', () => {
    const options = outputPairOptions([{ deviceId: 'x', label: 'Big', maxChannelCount: 6 }]);
    expect(options.map((o) => o.label)).toEqual([
      'Big (outs 1/2)',
      'Big (outs 3/4)',
      'Big (outs 5/6)',
    ]);
  });

  it('mixed lists keep enumeration order', () => {
    const options = outputPairOptions([stereo, fourOut]);
    expect(options.map((o) => o.label)).toEqual([
      MAC.label,
      `${INPULSE.label} (outs 1/2)`,
      `${INPULSE.label} (outs 3/4)`,
    ]);
  });
});

describe('sameOutputChoice', () => {
  it('matches by device id and pair, not label', () => {
    const saved = { deviceId: 'x', label: 'old label (outs 3/4)', pair: { left: 2, right: 3 } };
    expect(sameOutputChoice(saved, { deviceId: 'x', label: 'new', pair: { left: 2, right: 3 } })).toBe(
      true
    );
    expect(sameOutputChoice(saved, { deviceId: 'x', label: 'new', pair: { left: 0, right: 1 } })).toBe(
      false
    );
    expect(sameOutputChoice(saved, { deviceId: 'y', label: 'new', pair: { left: 2, right: 3 } })).toBe(
      false
    );
  });

  it('treats absent and null pair as the same (device default)', () => {
    expect(sameOutputChoice({ deviceId: 'x', label: 'a' }, { deviceId: 'x', label: 'b', pair: null })).toBe(
      true
    );
    expect(
      sameOutputChoice({ deviceId: 'x', label: 'a' }, { deviceId: 'x', label: 'b', pair: { left: 2, right: 3 } })
    ).toBe(false);
  });
});

describe('parseRoutingPrefs (headphone-cue 04)', () => {
  it('revives a well-formed blob, including a cue pair', () => {
    expect(
      parseRoutingPrefs({ master: MAC, cue: { ...INPULSE, pair: { left: 2, right: 3 } } })
    ).toEqual({
      master: { ...MAC, pair: null },
      cue: { ...INPULSE, pair: { left: 2, right: 3 } },
    });
  });

  it('degrades garbage to the defaults', () => {
    expect(parseRoutingPrefs(null)).toEqual(DEFAULT_ROUTING_PREFS);
    expect(parseRoutingPrefs('nope')).toEqual(DEFAULT_ROUTING_PREFS);
    expect(parseRoutingPrefs(42)).toEqual(DEFAULT_ROUTING_PREFS);
  });

  it('degrades each malformed bus independently', () => {
    expect(parseRoutingPrefs({ master: MAC, cue: { deviceId: 7 } })).toEqual({
      master: { ...MAC, pair: null },
      cue: null,
    });
    expect(parseRoutingPrefs({ master: { label: 'no id' }, cue: INPULSE })).toEqual({
      master: null,
      cue: { ...INPULSE, pair: null },
    });
  });

  it('drops malformed pairs but keeps the device', () => {
    expect(parseRoutingPrefs({ master: null, cue: { ...INPULSE, pair: { left: 'x' } } })).toEqual({
      master: null,
      cue: { ...INPULSE, pair: null },
    });
    expect(parseRoutingPrefs({ master: null, cue: { ...INPULSE, pair: { left: -2, right: 3 } } })).toEqual(
      { master: null, cue: { ...INPULSE, pair: null } }
    );
  });

  it('rejects empty device ids (Chrome uses "" for masked entries)', () => {
    expect(parseRoutingPrefs({ master: { deviceId: '', label: 'x' }, cue: null })).toEqual(
      DEFAULT_ROUTING_PREFS
    );
  });
});

describe('cueChannelPair (auto fallback when no pair chosen)', () => {
  it('stereo (and smaller) devices use the default pair', () => {
    expect(cueChannelPair(INPULSE.label, 0)).toBeNull();
    expect(cueChannelPair(INPULSE.label, 1)).toBeNull();
    expect(cueChannelPair(INPULSE.label, 2)).toBeNull();
    expect(cueChannelPair(INPULSE.label, 3)).toBeNull();
  });

  it('a 4-out interface (the Inpulse) gets the headphone pair, 0-based 2/3', () => {
    expect(cueChannelPair(INPULSE.label, 4)).toEqual({ left: 2, right: 3 });
  });

  it('does not transfer the Inpulse channel order to unknown or unverified devices', () => {
    expect(cueChannelPair('Big generic interface', 8)).toBeNull();
    expect(cueChannelPair(GRV6.label, 8)).toBeNull();
  });
});

describe('planOutput (four-deck 32: single-context same-device delivery)', () => {
  const PAIR_12 = { left: 0, right: 1 };
  const PAIR_34 = { left: 2, right: 3 };

  it('all defaults: main context on the system default, no pairs, no bridge', () => {
    expect(
      planOutput({ masterSinkId: null, masterPair: null, cueSinkId: null, cuePair: null })
    ).toEqual({ mainSinkId: '', masterPairInMain: null, cuePairInMain: null, cueBridge: null });
  });

  it('master+cue on the same device with explicit pairs: single context, no bridge', () => {
    expect(
      planOutput({
        masterSinkId: GRV6.deviceId,
        masterPair: PAIR_12,
        cueSinkId: GRV6.deviceId,
        cuePair: PAIR_34,
      })
    ).toEqual({
      mainSinkId: GRV6.deviceId,
      masterPairInMain: PAIR_12,
      cuePairInMain: PAIR_34,
      cueBridge: null,
    });
  });

  it('cross-device cue keeps the bridge; master stays on the main destination', () => {
    expect(
      planOutput({
        masterSinkId: GRV6.deviceId,
        masterPair: PAIR_12,
        cueSinkId: INPULSE.deviceId,
        cuePair: PAIR_34,
      })
    ).toEqual({
      mainSinkId: GRV6.deviceId,
      masterPairInMain: PAIR_12,
      cuePairInMain: null,
      cueBridge: { sinkId: INPULSE.deviceId, pair: PAIR_34 },
    });
  });

  it('master on the system default is never the same device as an explicit cue sink', () => {
    expect(
      planOutput({ masterSinkId: null, masterPair: null, cueSinkId: GRV6.deviceId, cuePair: PAIR_34 })
    ).toEqual({
      mainSinkId: '',
      masterPairInMain: null,
      cuePairInMain: null,
      cueBridge: { sinkId: GRV6.deviceId, pair: PAIR_34 },
    });
  });

  it('same device without an explicit cue pair stays on the bridge (auto = device default)', () => {
    expect(
      planOutput({
        masterSinkId: GRV6.deviceId,
        masterPair: PAIR_12,
        cueSinkId: GRV6.deviceId,
        cuePair: null,
      })
    ).toEqual({
      mainSinkId: GRV6.deviceId,
      masterPairInMain: PAIR_12,
      cuePairInMain: null,
      cueBridge: { sinkId: GRV6.deviceId, pair: null },
    });
  });

  it('explicit master device without a pair follows the sink with a plain destination', () => {
    expect(
      planOutput({ masterSinkId: MAC.deviceId, masterPair: null, cueSinkId: null, cuePair: null })
    ).toEqual({ mainSinkId: MAC.deviceId, masterPairInMain: null, cuePairInMain: null, cueBridge: null });
  });
});
