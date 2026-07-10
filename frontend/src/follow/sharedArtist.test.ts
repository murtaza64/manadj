import { describe, expect, it } from 'vitest';
import { ARTIST_SIMILARITY_THRESHOLD, artistTokens, sharedArtist } from './sharedArtist';

describe('artistTokens', () => {
  it('splits feat./ft./featuring collaborations', () => {
    expect(artistTokens('Sub Focus feat. Kele')).toEqual(['sub focus', 'kele']);
    expect(artistTokens('Sub Focus ft Kele')).toEqual(['sub focus', 'kele']);
    expect(artistTokens('Sub Focus featuring Kele')).toEqual(['sub focus', 'kele']);
  });

  it('splits &, and, comma, x, vs, +', () => {
    expect(artistTokens('Camo & Krooked')).toEqual(['camo', 'krooked']);
    expect(artistTokens('Camo and Krooked')).toEqual(['camo', 'krooked']);
    expect(artistTokens('Noisia, Phace')).toEqual(['noisia', 'phace']);
    expect(artistTokens('Skrillex x Flowdan')).toEqual(['skrillex', 'flowdan']);
    expect(artistTokens('Fred again.. vs Skepta')).toEqual(['fred again', 'skepta']);
    expect(artistTokens('Chase + Status')).toEqual(['chase', 'status']);
  });

  it('does not split words containing separator letters', () => {
    // 'x' and 'and' are word-bounded: Xample and Andromeda survive whole.
    expect(artistTokens('Xample')).toEqual(['xample']);
    expect(artistTokens('Andromeda')).toEqual(['andromeda']);
    expect(artistTokens('Fox Stevenson')).toEqual(['fox stevenson']);
  });

  it('normalizes case and punctuation, drops empty and one-char tokens', () => {
    expect(artistTokens('  A.M.C ')).toEqual(['amc']);
    expect(artistTokens(null)).toEqual([]);
    expect(artistTokens(undefined)).toEqual([]);
    expect(artistTokens('')).toEqual([]);
  });
});

describe('sharedArtist', () => {
  it('matches a solo artist against their collab strings', () => {
    expect(sharedArtist('Sub Focus', 'Sub Focus feat. Kele')).toBe(true);
    expect(sharedArtist('Camo & Krooked', 'Camo and Krooked')).toBe(true);
    expect(sharedArtist('Kele', 'Sub Focus feat. Kele')).toBe(true);
  });

  it('matches order-swapped collabs', () => {
    expect(sharedArtist('Krooked & Camo', 'Camo & Krooked')).toBe(true);
  });

  it('survives typos within the similarity threshold', () => {
    expect(sharedArtist('Camo & Krooked', 'Camo & Krookd')).toBe(true);
    expect(sharedArtist('Netsky', 'Netskyy')).toBe(true);
  });

  it('keeps distinct artists apart', () => {
    expect(sharedArtist('Noisia', 'Phace')).toBe(false);
    expect(sharedArtist('Sub Focus', 'Fox Stevenson')).toBe(false);
    // Short names with one letter changed are different artists, not typos.
    expect(sharedArtist('Koan', 'Kran')).toBe(false);
  });

  it('missing artists never match', () => {
    expect(sharedArtist(null, 'Noisia')).toBe(false);
    expect(sharedArtist('Noisia', undefined)).toBe(false);
    expect(sharedArtist(null, null)).toBe(false);
  });

  it('threshold constant is exported for tuning', () => {
    expect(ARTIST_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(ARTIST_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
