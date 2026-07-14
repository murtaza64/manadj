/**
 * Per-Deck row evidence seam (four-deck-performance 21): packing must be
 * memo-stable (equal evidence → equal string), cover all four Decks, and
 * round-trip through parse; the tooltip names every contributing Deck.
 */
import { describe, expect, it } from 'vitest';
import type { ChannelId } from '../playback/mixer';
import {
  packRowEvidence,
  parseRowEvidence,
  rowEvidenceTitle,
  type TransitionMark,
} from './rowEvidence';

function pack(
  marks: Partial<Record<ChannelId, TransitionMark>>,
  linked: Partial<Record<ChannelId, boolean>>
): string {
  return packRowEvidence(
    (deck) => marks[deck] ?? 'none',
    (deck) => linked[deck] ?? false
  );
}

describe('packRowEvidence', () => {
  it('packs nothing to the empty string', () => {
    expect(pack({}, {})).toBe('');
  });

  it('covers C and D, not just A/B', () => {
    expect(pack({ C: 'saved' }, { D: true })).toBe('C:saved:0,D:none:1');
  });

  it('is stable A→D regardless of evidence kind', () => {
    expect(pack({ D: 'preferred', B: 'saved' }, { A: true })).toBe(
      'A:none:1,B:saved:0,D:preferred:0'
    );
  });

  it('packs equal evidence identically (row memo contract)', () => {
    const a = pack({ A: 'saved', C: 'preferred' }, { C: true });
    const b = pack({ C: 'preferred', A: 'saved' }, { C: true });
    expect(a).toBe(b);
  });
});

describe('parseRowEvidence', () => {
  it('round-trips a multi-Deck pack', () => {
    const packed = pack({ A: 'preferred', C: 'saved' }, { B: true, C: true });
    expect(parseRowEvidence(packed)).toEqual([
      { deck: 'A', mark: 'preferred', linked: false },
      { deck: 'B', mark: 'none', linked: true },
      { deck: 'C', mark: 'saved', linked: true },
    ]);
  });

  it('parses the empty pack to no evidence', () => {
    expect(parseRowEvidence('')).toEqual([]);
  });
});

describe('rowEvidenceTitle', () => {
  it('names every contributing Deck A–D, both evidence kinds', () => {
    const title = rowEvidenceTitle(
      parseRowEvidence(pack({ C: 'preferred' }, { C: true, D: true }))
    )!;
    expect(title).toContain("Saved transition from deck C's track (favorite)");
    expect(title).toContain("Linked with deck C's track");
    expect(title).toContain("Linked with deck D's track");
  });

  it('is undefined without evidence', () => {
    expect(rowEvidenceTitle([])).toBeUndefined();
  });
});
