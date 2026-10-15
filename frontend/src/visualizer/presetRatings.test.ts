import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetPresetRatings, gaPresetId, ratePreset, tallyFor } from './presetRatings';

afterEach(() => { _resetPresetRatings(); vi.unstubAllGlobals(); });

describe('presetRatings', () => {
  it('maps curated ids to their g00 seed', () => {
    expect(gaPresetId('voyage')).toBe('g00-voyage');
    expect(gaPresetId('g12-foo')).toBe('g12-foo');
    expect(tallyFor({ 'g00-voyage': { likes: 1, dislikes: 0, neutral: 0, score: 1, last: null } }, 'voyage')?.likes).toBe(1);
    expect(tallyFor({ odyssey: { likes: 2, dislikes: 0, neutral: 0, score: 2, last: null } }, 'odyssey')?.likes).toBe(2);
  });
  it('re-rating the same preset in the same place reuses the verdict uuid', async () => {
    const bodies: { uuid: string; outcome: string; source: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ presets: {} }), { status: 200 });
    }));
    const args = { presetId: 'voyage', source: 'clip-editor' as const, contextKey: 'routine:a' };
    await ratePreset({ ...args, outcome: 'like' });
    await ratePreset({ ...args, outcome: 'dislike' });
    await ratePreset({ ...args, contextKey: 'routine:b', outcome: 'like' });
    expect(bodies[0].uuid).toBe(bodies[1].uuid);
    expect(bodies[2].uuid).not.toBe(bodies[0].uuid);
    expect(bodies.map((b) => b.outcome)).toEqual(['like', 'dislike', 'like']);
  });
});
