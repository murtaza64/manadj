/** Deck colors (deck-colors 01): triplet derivation. (Var installation
 * moved to theme/tokens.ts installTheme — see tokens.test.ts.) */
import { describe, expect, it } from 'vitest';

import { hexToRgbTriplet } from './deckColors';

describe('deckColors', () => {
  it('derives comma-separated rgb triplets from the hex pair', () => {
    expect(hexToRgbTriplet('#00e5ff')).toBe('0, 229, 255');
    expect(hexToRgbTriplet('#ff2d95')).toBe('255, 45, 149');
  });
});
