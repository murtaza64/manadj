// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isTextEntryTarget, isTypingTarget } from './performanceKeys';

function input(type: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return el;
}

describe('isTextEntryTarget (the hubs\' typing guard, keyboard-focus 01)', () => {
  it.each(['text', 'search', 'number', 'url', 'email', 'password'])(
    'guards text-like input type=%s',
    (type) => {
      expect(isTextEntryTarget(input(type))).toBe(true);
    }
  );

  it.each(['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'])(
    'does NOT guard non-typing input type=%s (a leaked focus must not silence transport keys)',
    (type) => {
      expect(isTextEntryTarget(input(type))).toBe(false);
    }
  );

  it('guards textareas', () => {
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
  });

  it('guards contentEditable elements', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    expect(isTextEntryTarget(el)).toBe(true);
  });

  it('does not guard buttons, selects, plain divs, or nothing', () => {
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false);
    expect(isTextEntryTarget(document.createElement('select'))).toBe(false);
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });

  it('isTypingTarget reads the event target', () => {
    const el = input('text');
    document.body.appendChild(el);
    let seen: boolean | null = null;
    el.addEventListener('keydown', (e) => {
      seen = isTypingTarget(e as KeyboardEvent);
    });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(seen).toBe(true);
    el.remove();
  });
});
