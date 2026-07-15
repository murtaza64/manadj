import { describe, expect, it } from 'vitest';
import {
  addJogMessage,
  decodeGrv6JogMessage,
  emptyJogStreamStats,
  jogStatsRate,
} from './jogTelemetry';

describe('GRV6 jog telemetry', () => {
  it('decodes all documented relative streams and Deck channels', () => {
    expect(decodeGrv6JogMessage([0xb0, 33, 65])).toEqual({ deck: 'A', stream: 'side', ticks: 1 });
    expect(decodeGrv6JogMessage([0xb3, 34, 62])).toEqual({ deck: 'D', stream: 'platter-vinyl', ticks: -2 });
    expect(decodeGrv6JogMessage([0xb1, 35, 65])?.stream).toBe('platter-no-vinyl');
    expect(decodeGrv6JogMessage([0xb2, 38, 65])?.stream).toBe('shift-side');
    expect(decodeGrv6JogMessage([0xb2, 41, 65])?.stream).toBe('shift-platter');
  });

  it('drops rest, unrelated, and non-deck messages', () => {
    expect(decodeGrv6JogMessage([0xb0, 33, 64])).toBeNull();
    expect(decodeGrv6JogMessage([0xb0, 99, 65])).toBeNull();
    expect(decodeGrv6JogMessage([0x90, 33, 65])).toBeNull();
    expect(decodeGrv6JogMessage([0xb6, 33, 65])).toBeNull();
  });

  it('accumulates revolution counts and observed rates', () => {
    const message = { deck: 'A' as const, stream: 'side' as const, ticks: 3 };
    const first = addJogMessage(emptyJogStreamStats(), message, 1000);
    const second = addJogMessage(first, { ...message, ticks: -2 }, 1100);
    expect(second).toMatchObject({ messages: 2, signedTicks: 1, absoluteTicks: 5, maxDelta: 3 });
    expect(jogStatsRate(second)).toEqual({ messagesPerSecond: 20, ticksPerSecond: 50 });
  });
});
