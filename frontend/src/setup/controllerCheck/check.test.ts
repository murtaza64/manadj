import { describe, expect, it } from 'vitest';
import { CONTROLLER_MODELS } from '../../midi/mappings';
import { DDJ_GRV6 } from '../../midi/mappings/ddjGrv6';
import { DDJ_SB3 } from '../../midi/mappings/ddjSb3';
import { INPULSE_300_MK2 } from '../../midi/mappings/inpulse300mk2';
import type { Binding } from '../../midi/mapping';
import {
  bindingCount,
  bindingForMessage,
  decodeMessage,
  describeBinding,
  jogProfileOf,
  modelForPort,
} from './check';

describe('modelForPort', () => {
  it('matches every shipped model by port name', () => {
    expect(modelForPort('AlphaTheta DDJ-GRV6', CONTROLLER_MODELS)?.mapping).toBe(DDJ_GRV6);
    expect(modelForPort('PIONEER DDJ-SB3', CONTROLLER_MODELS)?.mapping).toBe(DDJ_SB3);
    expect(modelForPort('DJControl Inpulse 300 MK2', CONTROLLER_MODELS)?.mapping).toBe(INPULSE_300_MK2);
  });
  it('returns null for unsupported devices', () => {
    expect(modelForPort('Launchpad X', CONTROLLER_MODELS)).toBeNull();
  });
});

describe('decodeMessage', () => {
  it('decodes note on/off and cc', () => {
    expect(decodeMessage([0x91, 0x0b, 0x7f])).toEqual({ message: 'note', channel: 1, number: 0x0b, value: 0x7f });
    expect(decodeMessage([0x81, 0x0b, 0x40])).toEqual({ message: 'note', channel: 1, number: 0x0b, value: 0 });
    expect(decodeMessage([0xb0, 0x13, 0x22])).toEqual({ message: 'cc', channel: 0, number: 0x13, value: 0x22 });
  });
  it('ignores other statuses', () => {
    expect(decodeMessage([0xf8])).toBeNull();
    expect(decodeMessage([0xe0, 0, 0])).toBeNull();
  });
});

describe('bindingForMessage', () => {
  it('finds every binding of a mapping by its own matcher', () => {
    for (const b of DDJ_GRV6.bindings) {
      const hit = bindingForMessage(DDJ_GRV6, { ...b.match, value: 127 });
      expect(hit?.match).toEqual(b.match);
    }
  });
  it('resolves a 14-bit LSB to its binding', () => {
    const fine = DDJ_GRV6.bindings.find(
      (b): b is Extract<Binding, { controlType: 'absolute' }> =>
        b.controlType === 'absolute' && b.lsbNumber !== undefined
    );
    expect(fine).toBeDefined();
    const hit = bindingForMessage(DDJ_GRV6, {
      message: 'cc',
      channel: fine!.match.channel,
      number: fine!.lsbNumber!,
      value: 3,
    });
    expect(hit).toBe(fine);
  });
  it('returns null for unmapped messages', () => {
    expect(bindingForMessage(DDJ_GRV6, { message: 'note', channel: 15, number: 0x7f, value: 1 })).toBeNull();
  });
});

describe('describeBinding', () => {
  const button = (target: object): Binding =>
    ({ match: { message: 'note', channel: 0, number: 0 }, controlType: 'button', target }) as Binding;
  it('labels deck, channel and global targets', () => {
    expect(describeBinding(button({ control: 'hot-cue', deck: 'A', pad: 3 }))).toBe('Deck A · hot cue 3');
    expect(describeBinding(button({ control: 'pfl', channel: 'B' }))).toBe('Channel B · pfl');
    expect(describeBinding(button({ control: 'quantize' }))).toBe('quantize');
    expect(describeBinding(button({ control: 'jog-touch-edge', deck: 'C', shifted: true }))).toBe(
      'Deck C · jog touch edge shifted'
    );
  });
});

describe('jog calibration', () => {
  it('reports the jog profile each mapping carries', () => {
    expect(jogProfileOf(DDJ_GRV6)).toBe('grv6');
    expect(jogProfileOf(DDJ_SB3)).toBe('ddj-sb3');
    expect(jogProfileOf(INPULSE_300_MK2)).toBeNull();
  });
});

it('counts distinct physical controls', () => {
  expect(bindingCount(DDJ_GRV6)).toBeGreaterThan(10);
  expect(bindingCount(DDJ_GRV6)).toBeLessThanOrEqual(DDJ_GRV6.bindings.length);
});
