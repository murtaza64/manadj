import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetControlFocusForTests,
  focusDeck,
  getControlFocus,
  subscribeControlFocus,
  toggleControlFocus,
} from './controlFocus';

afterEach(_resetControlFocusForTests);

describe('Control focus', () => {
  it('starts on A/B and toggles each physical side independently', () => {
    expect(getControlFocus()).toEqual({ left: 'A', right: 'B' });
    toggleControlFocus('left');
    expect(getControlFocus()).toEqual({ left: 'C', right: 'B' });
    toggleControlFocus('right');
    expect(getControlFocus()).toEqual({ left: 'C', right: 'D' });
  });

  it('focuses a Deck on its side without disturbing the other side', () => {
    focusDeck('C');
    focusDeck('D');
    focusDeck('A');
    expect(getControlFocus()).toEqual({ left: 'A', right: 'D' });
  });

  it('notifies only when focus changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeControlFocus(listener);
    focusDeck('A');
    focusDeck('C');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
