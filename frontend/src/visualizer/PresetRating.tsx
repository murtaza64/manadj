/**
 * Thumbs rating for one visualizer preset (#401): LIKE / NOPE with the
 * preset's all-surface tally. Lit button = this run's verdict here.
 */
import { ratePreset, tallyFor, usePresetRatings, verdictKey, type RateArgs, type RatingOutcome } from './presetRatings';
import './PresetRating.css';

interface Props extends Omit<RateArgs, 'outcome'> {
  onError?: (message: string) => void;
}

export function PresetRating({ onError, ...args }: Props) {
  const { tallies, mine } = usePresetRatings();
  const tally = tallyFor(tallies, args.presetId);
  const current = mine[verdictKey(args.source, args.presetId, args.contextKey)];
  const rate = (outcome: RatingOutcome) => {
    ratePreset({ ...args, outcome }).catch((err: unknown) => onError?.(err instanceof Error ? err.message : String(err)));
  };
  return (
    <span className="preset-rating" data-testid="preset-rating">
      <button
        className={`btn btn-mini preset-rating-like${current === 'like' ? ' preset-rating-on' : ''}`}
        title="Like this preset (G)"
        onClick={() => rate('like')}
      >LIKE{tally ? ` ${tally.likes}` : ''}</button>
      <button
        className={`btn btn-mini preset-rating-dislike${current === 'dislike' ? ' preset-rating-on' : ''}`}
        title="Dislike this preset (B)"
        onClick={() => rate('dislike')}
      >NOPE{tally ? ` ${tally.dislikes}` : ''}</button>
    </span>
  );
}
