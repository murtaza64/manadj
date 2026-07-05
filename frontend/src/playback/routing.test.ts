/**
 * Routing resolution (headphone-cue 01): the pure seam between saved device
 * choices and the sinks the audio layer applies. Master must never go
 * silent; the Cue bus degrades to disabled.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING_PREFS, resolveRouting } from './routing';
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
      cueMissing: true,
    });
  });
});
