import type { ChannelId } from '../playback/mixer';
import type { PlayGuide, PlayGuideFrame } from './playGuideModel';

export interface MinimapGuide {
  key: string;
  incoming: ChannelId;
  guide: PlayGuide;
  next: boolean;
}

/** Flatten every pair frame for one outgoing Deck and identify the earliest
 * upcoming guide across all paused targets. */
export function minimapGuidesForDeck(
  frames: PlayGuideFrame[],
  deck: ChannelId,
  duration: number
): MinimapGuide[] {
  if (duration <= 0) return [];
  const guides = frames
    .filter((frame) => frame.outgoing === deck)
    .flatMap((frame) =>
      frame.guides
        .filter((guide) => guide.aTime >= 0 && guide.aTime <= duration)
        .map((guide) => ({
          key: `${frame.outgoing}>${frame.incoming}:${guide.uuid}`,
          incoming: frame.incoming,
          guide,
        }))
    );
  let nextKey: string | null = null;
  let nextTime = Infinity;
  for (const item of guides) {
    if (!item.guide.missed && item.guide.aTime < nextTime) {
      nextTime = item.guide.aTime;
      nextKey = item.key;
    }
  }
  return guides.map((item) => ({ ...item, next: item.key === nextKey }));
}
