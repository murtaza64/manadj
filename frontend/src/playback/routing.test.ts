/**
 * Routing resolution (headphone-cue 01): the pure seam between saved device
 * choices and the sinks the audio layer applies. Master must never go
 * silent; the Cue bus degrades to disabled.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTING_PREFS,
  cueChannelPair,
  cueOutputOptions,
  parseRoutingPrefs,
  resolveRouting,
  sameCueChoice,
} from './routing';
import type { RoutingPrefs } from './routing';

const MAC = { deviceId: 'mac-speakers', label: 'MacBook Pro Speakers' };
const INPULSE = { deviceId: 'inpulse-34', label: 'DJControl Inpulse 300 MK2' };

const prefs = (p: Partial<RoutingPrefs>): RoutingPrefs => ({
  ...DEFAULT_ROUTING_PREFS,
  ...p,
});

describe('resolveRouting', () => {
  it('nothing saved: master on the system default, cue disabled, nothing missing', () => {
    expect(resolveRouting(DEFAULT_ROUTING_PREFS, [MAC.deviceId])).toEqual({
      masterSinkId: null,
      masterMissing: false,
      cueSinkId: null,
      cuePair: null,
      cueMissing: false,
    });
  });

  it('saved devices present: both buses get their saved sinks', () => {
    const resolved = resolveRouting(prefs({ master: MAC, cue: INPULSE }), [
      MAC.deviceId,
      INPULSE.deviceId,
    ]);
    expect(resolved.masterSinkId).toBe(MAC.deviceId);
    expect(resolved.cueSinkId).toBe(INPULSE.deviceId);
    expect(resolved.masterMissing).toBe(false);
    expect(resolved.cueMissing).toBe(false);
  });

  it('a saved cue pair rides through resolution', () => {
    const resolved = resolveRouting(
      prefs({ cue: { ...INPULSE, pair: { left: 2, right: 3 } } }),
      [INPULSE.deviceId]
    );
    expect(resolved.cueSinkId).toBe(INPULSE.deviceId);
    expect(resolved.cuePair).toEqual({ left: 2, right: 3 });
  });

  it('saved master missing: falls back to the system default and says so', () => {
    const resolved = resolveRouting(prefs({ master: INPULSE }), [MAC.deviceId]);
    expect(resolved.masterSinkId).toBeNull();
    expect(resolved.masterMissing).toBe(true);
  });

  it('saved cue device missing: cue disabled and flagged, master untouched', () => {
    const resolved = resolveRouting(prefs({ master: MAC, cue: INPULSE }), [MAC.deviceId]);
    expect(resolved.masterSinkId).toBe(MAC.deviceId);
    expect(resolved.masterMissing).toBe(false);
    expect(resolved.cueSinkId).toBeNull();
    expect(resolved.cuePair).toBeNull();
    expect(resolved.cueMissing).toBe(true);
  });

  it('no cue saved is not "missing" — just off', () => {
    const resolved = resolveRouting(prefs({ master: MAC }), [MAC.deviceId]);
    expect(resolved.cueSinkId).toBeNull();
    expect(resolved.cueMissing).toBe(false);
  });

  it('master and cue may share a device (single-interface setups)', () => {
    const resolved = resolveRouting(prefs({ master: INPULSE, cue: INPULSE }), [
      INPULSE.deviceId,
    ]);
    expect(resolved.masterSinkId).toBe(INPULSE.deviceId);
    expect(resolved.cueSinkId).toBe(INPULSE.deviceId);
  });

  it('everything unplugged: master default, cue disabled, both flagged', () => {
    const resolved = resolveRouting(prefs({ master: MAC, cue: INPULSE }), []);
    expect(resolved).toEqual({
      masterSinkId: null,
      masterMissing: true,
      cueSinkId: null,
      cuePair: null,
      cueMissing: true,
    });
  });
});

describe('cueOutputOptions (explicit output pairs)', () => {
  const stereo = { ...MAC, maxChannelCount: 2 };
  const fourOut = { ...INPULSE, maxChannelCount: 4 };

  it('a stereo device is one plain entry', () => {
    expect(cueOutputOptions([stereo])).toEqual([
      { deviceId: MAC.deviceId, label: MAC.label, pair: null },
    ]);
  });

  it('a 4-out interface splits into two 1-based-labelled pairs', () => {
    expect(cueOutputOptions([fourOut])).toEqual([
      { deviceId: INPULSE.deviceId, label: `${INPULSE.label} (outs 1/2)`, pair: { left: 0, right: 1 } },
      { deviceId: INPULSE.deviceId, label: `${INPULSE.label} (outs 3/4)`, pair: { left: 2, right: 3 } },
    ]);
  });

  it('bigger interfaces get one entry per pair', () => {
    const options = cueOutputOptions([{ deviceId: 'x', label: 'Big', maxChannelCount: 6 }]);
    expect(options.map((o) => o.label)).toEqual([
      'Big (outs 1/2)',
      'Big (outs 3/4)',
      'Big (outs 5/6)',
    ]);
  });

  it('mixed lists keep enumeration order', () => {
    const options = cueOutputOptions([stereo, fourOut]);
    expect(options.map((o) => o.label)).toEqual([
      MAC.label,
      `${INPULSE.label} (outs 1/2)`,
      `${INPULSE.label} (outs 3/4)`,
    ]);
  });
});

describe('sameCueChoice', () => {
  it('matches by device id and pair, not label', () => {
    const saved = { deviceId: 'x', label: 'old label (outs 3/4)', pair: { left: 2, right: 3 } };
    expect(sameCueChoice(saved, { deviceId: 'x', label: 'new', pair: { left: 2, right: 3 } })).toBe(
      true
    );
    expect(sameCueChoice(saved, { deviceId: 'x', label: 'new', pair: { left: 0, right: 1 } })).toBe(
      false
    );
    expect(sameCueChoice(saved, { deviceId: 'y', label: 'new', pair: { left: 2, right: 3 } })).toBe(
      false
    );
  });

  it('treats absent and null pair as the same (device default)', () => {
    expect(sameCueChoice({ deviceId: 'x', label: 'a' }, { deviceId: 'x', label: 'b', pair: null })).toBe(
      true
    );
    expect(
      sameCueChoice({ deviceId: 'x', label: 'a' }, { deviceId: 'x', label: 'b', pair: { left: 2, right: 3 } })
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
    expect(cueChannelPair(0)).toBeNull();
    expect(cueChannelPair(1)).toBeNull();
    expect(cueChannelPair(2)).toBeNull();
    expect(cueChannelPair(3)).toBeNull();
  });

  it('a 4-out interface (the Inpulse) gets the headphone pair, 0-based 2/3', () => {
    expect(cueChannelPair(4)).toEqual({ left: 2, right: 3 });
  });

  it('bigger interfaces still cue on 3/4', () => {
    expect(cueChannelPair(6)).toEqual({ left: 2, right: 3 });
    expect(cueChannelPair(8)).toEqual({ left: 2, right: 3 });
  });
});
