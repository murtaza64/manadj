import type { ChannelId } from '../playback/mixer';

export type Grv6JogStream =
  | 'side'
  | 'platter-vinyl'
  | 'platter-no-vinyl'
  | 'shift-side'
  | 'shift-platter';

export interface Grv6JogMessage {
  deck: ChannelId;
  stream: Grv6JogStream;
  ticks: number;
}

export interface JogStreamStats {
  messages: number;
  signedTicks: number;
  absoluteTicks: number;
  maxDelta: number;
  lastDelta: number;
  firstAtMs: number | null;
  lastAtMs: number | null;
}

export function emptyJogStreamStats(): JogStreamStats {
  return {
    messages: 0,
    signedTicks: 0,
    absoluteTicks: 0,
    maxDelta: 0,
    lastDelta: 0,
    firstAtMs: null,
    lastAtMs: null,
  };
}

const STREAM_BY_CC: Partial<Record<number, Grv6JogStream>> = {
  33: 'side',
  34: 'platter-vinyl',
  35: 'platter-no-vinyl',
  38: 'shift-side',
  41: 'shift-platter',
};

const DECKS: readonly ChannelId[] = ['A', 'B', 'C', 'D'];

export function decodeGrv6JogMessage(bytes: ArrayLike<number>): Grv6JogMessage | null {
  if (bytes.length < 3 || bytes[0] >> 4 !== 0xb) return null;
  const deck = DECKS[bytes[0] & 0x0f];
  const stream = STREAM_BY_CC[bytes[1]];
  if (!deck || !stream) return null;
  const ticks = bytes[2] - 0x40;
  return ticks === 0 ? null : { deck, stream, ticks };
}

export function addJogMessage(
  stats: JogStreamStats,
  message: Grv6JogMessage,
  atMs: number
): JogStreamStats {
  return {
    messages: stats.messages + 1,
    signedTicks: stats.signedTicks + message.ticks,
    absoluteTicks: stats.absoluteTicks + Math.abs(message.ticks),
    maxDelta: Math.max(stats.maxDelta, Math.abs(message.ticks)),
    lastDelta: message.ticks,
    firstAtMs: stats.firstAtMs ?? atMs,
    lastAtMs: atMs,
  };
}

export function jogStatsRate(stats: JogStreamStats): { messagesPerSecond: number; ticksPerSecond: number } {
  if (stats.firstAtMs === null || stats.lastAtMs === null || stats.lastAtMs <= stats.firstAtMs) {
    return { messagesPerSecond: 0, ticksPerSecond: 0 };
  }
  const seconds = (stats.lastAtMs - stats.firstAtMs) / 1000;
  return {
    messagesPerSecond: stats.messages / seconds,
    ticksPerSecond: stats.absoluteTicks / seconds,
  };
}
