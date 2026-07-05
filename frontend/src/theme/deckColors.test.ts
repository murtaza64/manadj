/** Deck colors (deck-colors 01): triplet derivation + var installation. */
import { describe, expect, it } from 'vitest';

import { DECK_COLORS, hexToRgbTriplet, installDeckColorVars } from './deckColors';

describe('deckColors', () => {
  it('derives comma-separated rgb triplets from the hex pair', () => {
    expect(hexToRgbTriplet('#00e5ff')).toBe('0, 229, 255');
    expect(hexToRgbTriplet('#ff2d95')).toBe('255, 45, 149');
  });

  it('installs hex and rgb variables for both Decks', () => {
    const seen: Record<string, string> = {};
    installDeckColorVars({ style: { setProperty: (n, v) => void (seen[n] = v) } });
    expect(seen).toEqual({
      '--deck-a': DECK_COLORS.A,
      '--deck-a-rgb': '0, 229, 255',
      '--deck-b': DECK_COLORS.B,
      '--deck-b-rgb': '255, 45, 149',
    });
  });
});
