import { describe, expect, it } from 'vitest';
import {
  audioDeviceMapping,
  verifiedRouteDefaults,
} from './audioDeviceMapping';

describe('audioDeviceMapping', () => {
  it('recognizes DDJ-GRV6 audio-device labels without inventing channel order', () => {
    for (const label of ['DDJ-GRV6', 'AlphaTheta DDJ-GRV6', 'Pioneer DJ DDJ-GRV6']) {
      const mapping = audioDeviceMapping(label);
      expect(mapping?.model).toBe('ddj-grv6');
      expect(mapping?.routes).toBeNull();
      expect(mapping?.verification).toBe('required');
    }
  });

  it('does not mistake unrelated audio devices for the GRV6', () => {
    expect(audioDeviceMapping('MacBook Pro Speakers')).toBeNull();
    expect(audioDeviceMapping('DDJ-REV5')).toBeNull();
  });

  it('keeps the hardware-verified Inpulse Master/Cue pairs as device knowledge', () => {
    const mapping = audioDeviceMapping('DJControl Inpulse 300 Mk2');
    expect(mapping).toMatchObject({
      model: 'inpulse-300-mk2',
      routes: {
        master: { left: 0, right: 1 },
        cue: { left: 2, right: 3 },
      },
      verification: 'verified',
    });
    expect(verifiedRouteDefaults('DJControl Inpulse 300 Mk2', 4)).toEqual({
      master: { left: 0, right: 1 },
      cue: { left: 2, right: 3 },
    });
  });

  it('withholds defaults when the probe cannot reach every verified pair', () => {
    expect(verifiedRouteDefaults('DJControl Inpulse 300 Mk2', 2)).toBeNull();
    expect(verifiedRouteDefaults('DDJ-GRV6', 8)).toBeNull();
  });
});
