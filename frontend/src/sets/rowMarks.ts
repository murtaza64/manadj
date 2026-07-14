/**
 * Loaded/playing row marks (sets 35) — pure rules under vitest.
 *
 * A Set row mirrors LIVE deck occupancy (DeckEngine snapshots), never the
 * plan's ping-pong parity: after takeover, manual loads, or practice the
 * two can diverge, and the marks must follow reality. Glossary discipline
 * (CONTEXT.md "Deck color"): the loaded wash is deck IDENTITY (where the
 * track sits — one of the A–D identity colors); "it's playing" is a STATE and stays
 * deck-neutral (the green animated EQ bars). Replaces the single
 * conducting "active row" highlight — a conducting row is, by
 * definition, a loaded+playing row now.
 */
import { DECK_COLORS } from '../theme/deckColors';
import { CHANNEL_IDS } from '../playback/mixer';
import type { ChannelId } from '../playback/mixer';

/** One deck's live occupancy slice: what's loaded, whether it plays. */
export interface DeckOccupancy {
  trackId: number | null;
  playing: boolean;
}

export type DeckOccupancyMap = Record<ChannelId, DeckOccupancy>;

/** The Decks currently holding this Track (usually 0 or 1; several when the
 * same Track is loaded more than once). Order A–D — the wash gradient reads
 * left→right. */
export function loadedDecks(trackId: number, occupancy: DeckOccupancyMap): ChannelId[] {
  return CHANNEL_IDS.filter((d) => occupancy[d].trackId === trackId);
}

/** True when any deck holding this track is playing (the deck-neutral
 * STATE mark — never tinted per deck). */
export function isRowPlaying(trackId: number, occupancy: DeckOccupancyMap): boolean {
  return loadedDecks(trackId, occupancy).some((d) => occupancy[d].playing);
}

/** The loaded row's identity wash: each holding Deck's color at low
 * alpha (the conducting-wash idiom), in stable A→B→C→D order. Undefined
 * when not loaded — the row keeps its ordinary
 * background (hover/selection CSS). Inline on purpose: states outrank
 * the CSS hover wash (perf-layout 08), and inline wins. */
export function loadedWash(decks: ChannelId[]): string | undefined {
  if (decks.length === 0) return undefined;
  const mix = (d: ChannelId) => `color-mix(in srgb, ${DECK_COLORS[d]} 16%, transparent)`;
  if (decks.length === 1) return `linear-gradient(${mix(decks[0])}, ${mix(decks[0])})`;
  return `linear-gradient(90deg, ${decks.map(mix).join(', ')})`;
}
