/**
 * Six-pair Link toggles on the Performance surface (four-deck-performance
 * 19). Four loaded Tracks make six unordered pairs; every pair gets a
 * dedicated toggle placed by its Deck geometry:
 *
 * - The four ADJACENT pairs (A·B, C·D, A·C, B·D) ride the shared edges of
 *   the 2×2 Deck grid as icon-only chips pulled in toward the grid
 *   center — position names the pair; the tooltip names it in full.
 * - The two DIAGONALS (A·D, B·C) have no shared edge; they sit on the
 *   mixer strip beside the crossfader as grid mini-maps: corner letters
 *   joined by the diagonal stroke the Link crosses, so which corners a
 *   chip joins is glanceable at speed.
 *
 * Semantics are LinkToggle's (linked-pairs PRD), unchanged: symmetric,
 * Track-based, one fact per unordered pair. Deck letters only locate a
 * toggle — the stored fact follows the Tracks when they move among Decks.
 * The linkable hint (favorited Transition, no Link) pulses here exactly as
 * it does on the editor toggle. This placement won the issue-19 prototype
 * over a two-tap chord, a six-chip panel, and per-deck toggle rows (see
 * the issue's comments for the verdict).
 */
import { useTransitionIndex } from '../editor/transitionIndex';
import { useDecks } from '../hooks/useDeck';
import type { ChannelId } from '../playback/mixer';
import type { Track } from '../types';
import { LinkIcon } from './LinkIcon';
import { pairHasFavoritedTransition } from './linkable';
import { isLinked, setLinked, useLinks } from './linkStore';
import './performancePairLinks.css';

/** Everything a pair chip needs to render and toggle. */
function usePairLink(a: ChannelId, b: ChannelId, ta: Track | null, tb: Track | null) {
  const links = useLinks();
  const index = useTransitionIndex();
  const togglable = !!ta && !!tb && ta.id !== tb.id;
  const linked = togglable && isLinked(links, ta.id, tb.id);
  const hint =
    togglable && !linked && pairHasFavoritedTransition(index, ta.id, tb.id);
  const title = !togglable
    ? ta && tb && ta.id === tb.id
      ? `${a} and ${b} hold the same Track`
      : `Load Tracks on ${a} and ${b} to link them`
    : linked
      ? `Unlink ${a} (${ta.title}) ↔ ${b} (${tb.title})`
      : hint
        ? `${a} ↔ ${b} has a favorited Transition — link them?`
        : `Link ${a} (${ta.title}) ↔ ${b} (${tb.title})`;
  const toggle = () => togglable && setLinked(ta.id, tb.id, !linked);
  return { togglable, linked, hint, title, toggle };
}

/** Icon-only toggle for an adjacent pair: the edge it sits on names it. */
export function PairEdgeChip({
  a,
  b,
  ta,
  tb,
}: {
  a: ChannelId;
  b: ChannelId;
  ta: Track | null;
  tb: Track | null;
}) {
  const { togglable, linked, hint, title, toggle } = usePairLink(a, b, ta, tb);
  return (
    <button
      className={`pairlink-chip${linked ? ' linked' : ''}${hint ? ' hint' : ''}`}
      aria-pressed={linked}
      disabled={!togglable}
      title={title}
      onClick={toggle}
    >
      <LinkIcon size={11} />
    </button>
  );
}

/**
 * Mini-map toggle for a diagonal pair: the two Deck letters in their grid
 * corners, joined by the stroke the Link crosses (A↘D descends, B↙C
 * ascends), with the chain icon riding the stroke's center.
 */
export function PairDiagonalChip({
  a,
  b,
  ta,
  tb,
}: {
  a: 'A' | 'B';
  b: 'C' | 'D';
  ta: Track | null;
  tb: Track | null;
}) {
  const { togglable, linked, hint, title, toggle } = usePairLink(a, b, ta, tb);
  const descending = a === 'A'; // A↘D; B↙C
  return (
    <button
      className={`pairlink-diag${linked ? ' linked' : ''}${hint ? ' hint' : ''}`}
      aria-pressed={linked}
      disabled={!togglable}
      title={title}
      onClick={toggle}
    >
      <span
        className={`pairlink-diag-letter deck-${a.toLowerCase()} ${
          descending ? 'pos-tl' : 'pos-tr'
        }`}
      >
        {a}
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <line x1={descending ? 5 : 19} y1={5} x2={descending ? 19 : 5} y2={19} />
      </svg>
      {/* The chain rides the stroke, rotated to lie along it. */}
      <span className={`pairlink-diag-icon${descending ? ' descending' : ''}`}>
        <LinkIcon size={10} />
      </span>
      <span
        className={`pairlink-diag-letter deck-${b.toLowerCase()} ${
          descending ? 'pos-br' : 'pos-bl'
        }`}
      >
        {b}
      </span>
    </button>
  );
}

/**
 * The four adjacent-pair chips. Mount inside `.perf-decks` (position:
 * relative) — each chip is absolutely placed on its shared edge.
 */
export function EdgePairLinks() {
  const decks = useDecks();
  const t = (d: ChannelId) => decks[d].loadedTrack ?? null;
  return (
    <>
      <div className="pairlink-edge edge-ab">
        <PairEdgeChip a="A" b="B" ta={t('A')} tb={t('B')} />
      </div>
      <div className="pairlink-edge edge-cd">
        <PairEdgeChip a="C" b="D" ta={t('C')} tb={t('D')} />
      </div>
      <div className="pairlink-edge edge-ac">
        <PairEdgeChip a="A" b="C" ta={t('A')} tb={t('C')} />
      </div>
      <div className="pairlink-edge edge-bd">
        <PairEdgeChip a="B" b="D" ta={t('B')} tb={t('D')} />
      </div>
    </>
  );
}

/**
 * The two diagonal-pair chips. Mount inside the mixer strip's wide
 * crossfader slot — they hang just right of it, clear of the fader's
 * centering flex math.
 */
export function DiagonalPairLinks() {
  const decks = useDecks();
  const t = (d: ChannelId) => decks[d].loadedTrack ?? null;
  return (
    <div className="pairlink-strip" title="Diagonal Deck pairs">
      <PairDiagonalChip a="A" b="D" ta={t('A')} tb={t('D')} />
      <PairDiagonalChip a="B" b="C" ta={t('B')} tb={t('C')} />
    </div>
  );
}
