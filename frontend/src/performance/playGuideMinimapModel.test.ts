import { describe, expect, it } from 'vitest';
import { minimapGuidesForDeck } from './playGuideMinimapModel';
import type { PlayGuide, PlayGuideFrame } from './playGuideModel';

const guide = (uuid: string, aTime: number, missed = false): PlayGuide => ({
  uuid,
  name: uuid,
  favorite: false,
  aTime,
  missed,
  requiredPitchPercent: null,
});

describe('minimapGuidesForDeck', () => {
  it('keeps every incoming pair for one outgoing Deck', () => {
    const frames: PlayGuideFrame[] = [
      { outgoing: 'A', incoming: 'B', guides: [guide('ab', 40)] },
      { outgoing: 'A', incoming: 'C', guides: [guide('ac', 20)] },
      { outgoing: 'A', incoming: 'D', guides: [guide('ad', 60)] },
      { outgoing: 'B', incoming: 'C', guides: [guide('bc', 10)] },
    ];
    const result = minimapGuidesForDeck(frames, 'A', 100);
    expect(result.map((item) => [item.incoming, item.guide.uuid])).toEqual([
      ['B', 'ab'],
      ['C', 'ac'],
      ['D', 'ad'],
    ]);
    expect(result.find((item) => item.next)?.guide.uuid).toBe('ac');
  });

  it('ignores missed guides for next emphasis and clips outside duration', () => {
    const frames: PlayGuideFrame[] = [
      { outgoing: 'C', incoming: 'A', guides: [guide('missed', 10, true)] },
      { outgoing: 'C', incoming: 'D', guides: [guide('next', 30), guide('late', 130)] },
    ];
    const result = minimapGuidesForDeck(frames, 'C', 100);
    expect(result.map((item) => item.guide.uuid)).toEqual(['missed', 'next']);
    expect(result.find((item) => item.next)?.guide.uuid).toBe('next');
  });
});
