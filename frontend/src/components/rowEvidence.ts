/**
 * Row evidence marks, per Deck (four-deck-performance 21). A library row
 * carries one evidence slot per Deck A–D whose loaded Track relates to it:
 * a directional saved/favorited Transition (◆/★) and/or the symmetric
 * Linked chain (linked-pairs 03). Strongest evidence wins the slot
 * (★ > 🔗 > ◆ — the Known ranking); the tooltip carries ALL of it.
 *
 * The per-row carrier is one PACKED STRING (`A:preferred:1,C:none:1`),
 * not objects — TrackRow is memoized, and string equality is what lets
 * unaffected rows skip re-rendering on Deck churn (the loaded-tint
 * `LoadedMark` idiom, issue 20).
 */
import type { ChannelId } from '../playback/mixer';

export type TransitionMark = 'none' | 'saved' | 'preferred';

export interface DeckEvidence {
  deck: ChannelId;
  mark: TransitionMark;
  linked: boolean;
}

export const MARK_DECKS: readonly ChannelId[] = ['A', 'B', 'C', 'D'];

/**
 * Pack a row's per-Deck evidence into the memo-friendly string. Decks
 * with no evidence are omitted; '' means the row carries none. Stable
 * A→D order, so equal evidence always packs identically.
 */
export function packRowEvidence(
  markOf: (deck: ChannelId) => TransitionMark,
  linkedOf: (deck: ChannelId) => boolean
): string {
  const segments: string[] = [];
  for (const deck of MARK_DECKS) {
    const mark = markOf(deck);
    const linked = linkedOf(deck);
    if (mark !== 'none' || linked) segments.push(`${deck}:${mark}:${linked ? 1 : 0}`);
  }
  return segments.join(',');
}

/** Unpack for rendering. Tolerates '' (no evidence). */
export function parseRowEvidence(packed: string): DeckEvidence[] {
  if (!packed) return [];
  return packed.split(',').map((segment) => {
    const [deck, mark, linked] = segment.split(':');
    return {
      deck: deck as ChannelId,
      mark: mark as TransitionMark,
      linked: linked === '1',
    };
  });
}

/** Tooltip: the FULL evidence behind every slot (slots show only the
 * strongest per Deck). Undefined when the row carries none. */
export function rowEvidenceTitle(evidence: DeckEvidence[]): string | undefined {
  const parts: string[] = [];
  for (const { deck, mark, linked } of evidence) {
    if (mark !== 'none') {
      parts.push(
        `Saved transition from deck ${deck}'s track${mark === 'preferred' ? ' (favorite)' : ''}`
      );
    }
    if (linked) parts.push(`Linked with deck ${deck}'s track`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
