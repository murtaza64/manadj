import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mixer } from './mixer';

const STORAGE_KEY = 'manadj-crossfader-assignments';
const POSITION_STORAGE_KEY = 'manadj-crossfader-position';

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Mixer crossfader assignment persistence', () => {
  it('defaults to A/C left and B/D right', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const mixer = new Mixer();
    expect(['A', 'B', 'C', 'D'].map((channel) => mixer.getCrossfaderAssignment(channel as 'A' | 'B' | 'C' | 'D'))).toEqual([
      'left',
      'right',
      'left',
      'right',
    ]);
  });

  it('restores persisted assignments in a new Mixer', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const first = new Mixer();
    first.engageAutomation();
    first.setCrossfaderAssignment('A', 'thru');
    first.setCrossfaderAssignment('D', 'left');

    const restarted = new Mixer();
    expect(restarted.getCrossfaderAssignment('A')).toBe('thru');
    expect(restarted.getCrossfaderAssignment('D')).toBe('left');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      A: 'thru',
      B: 'right',
      C: 'left',
      D: 'left',
    });
  });

  it('falls back per channel when persisted values are invalid', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({ [STORAGE_KEY]: '{"A":"thru","B":"wat","C":"right"}' })
    );
    const mixer = new Mixer();
    expect(mixer.getCrossfaderAssignment('A')).toBe('thru');
    expect(mixer.getCrossfaderAssignment('B')).toBe('right');
    expect(mixer.getCrossfaderAssignment('C')).toBe('right');
    expect(mixer.getCrossfaderAssignment('D')).toBe('right');
  });
});

describe('Mixer crossfader position persistence', () => {
  it('restores the last position in a new Mixer', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const first = new Mixer();
    first.engageAutomation(); // avoid constructing the audio graph in this store test
    first.setCrossfader(-0.63);

    const restarted = new Mixer();
    expect(restarted.getCrossfader()).toBe(-0.63);
    expect(localStorage.getItem(POSITION_STORAGE_KEY)).toBe('-0.63');
  });

  it('falls back to center for invalid persisted positions', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [POSITION_STORAGE_KEY]: 'wat' }));
    expect(new Mixer().getCrossfader()).toBe(0);
  });
});
