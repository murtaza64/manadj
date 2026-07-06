// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { NAVIGATE_SET_EVENT, requestSetNavigate } from './navigateToSet';
import { _resetSetStoreForTests, getSelectedSetId } from './setStore';

afterEach(() => {
  _resetSetStoreForTests();
});

describe('requestSetNavigate', () => {
  it('selects the set in the store (a fresh Library mount restores it)', () => {
    requestSetNavigate(7);
    expect(getSelectedSetId()).toBe(7);
  });

  it('fires the navigate event after the store write (a mounted Library reads the store)', () => {
    let selectedAtEvent: number | null = null;
    const onNavigate = () => {
      selectedAtEvent = getSelectedSetId();
    };
    window.addEventListener(NAVIGATE_SET_EVENT, onNavigate);
    try {
      requestSetNavigate(7);
    } finally {
      window.removeEventListener(NAVIGATE_SET_EVENT, onNavigate);
    }
    expect(selectedAtEvent).toBe(7);
  });
});
