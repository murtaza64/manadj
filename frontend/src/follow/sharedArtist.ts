/**
 * Shared artist detection (match-score PRD): evidence two Tracks go
 * together must survive the messy library — `Sub Focus` vs `Sub Focus
 * feat. Kele`, `Camo & Krooked` vs `Camo and Krooked`, typos. Whole-string
 * fuzzy matching was rejected (it misses the structural feat./collab mess,
 * the common case): split artist strings into collaborator tokens, then
 * compare token pairs with a normalized-Levenshtein threshold.
 *
 * Remixer extraction from titles is a named follow-up, not here.
 */

/** Minimum normalized similarity (1 − dist/maxLen) for two artist tokens
 * to count as the same artist. 0.8 admits a typo or two in a normal-length
 * name while keeping short distinct names apart. */
export const ARTIST_SIMILARITY_THRESHOLD = 0.8;

/**
 * Collaborator separators. Word-bounded so `x` splits `A x B` but not
 * `Xample`; `feat`/`ft`/`vs` with or without the dot.
 */
const SEPARATORS = /\bfeat\.?\b|\bfeaturing\b|\bft\.?\b|\bvs\.?\b|\band\b|\bx\b|[&,+]/gi;

/** Split an artist string into normalized collaborator tokens. */
export function artistTokens(artist: string | null | undefined): string[] {
  if (!artist) return [];
  return artist
    .toLowerCase()
    .replace(SEPARATORS, '\u0000')
    .split('\u0000')
    .map((token) => token.replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim())
    .filter((token) => token.length > 1);
}

/** Iterative two-row Levenshtein — strings here are artist-name length. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function similar(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return false;
  return 1 - levenshtein(a, b) / maxLen >= ARTIST_SIMILARITY_THRESHOLD;
}

/**
 * Do two artist strings share at least one collaborator? Binary by design
 * (PRD): any fuzzy token match counts, more matches don't count extra.
 */
export function sharedArtist(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const tokensA = artistTokens(a);
  if (tokensA.length === 0) return false;
  const tokensB = artistTokens(b);
  return tokensA.some((ta) => tokensB.some((tb) => similar(ta, tb)));
}
