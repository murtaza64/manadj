// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { browseLoadTarget, hasKeyboardOverlay, isQuantizeShortcut, isTextEntryTarget, isTypingTarget } from './performanceKeys';
import type { ControlFocus } from '../../performance/controlFocus';

function input(type: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return el;
}

it('reserves only Shift+Q, including repeats and composing events for the owner to guard', () => {
  for (const key of ['q', 'Q']) {
    expect(isQuantizeShortcut(new KeyboardEvent('keydown', { key, shiftKey: true }))).toBe(true);
    expect(isQuantizeShortcut(new KeyboardEvent('keydown', { key, shiftKey: true, repeat: true, isComposing: true }))).toBe(true);
    for (const options of [{ shiftKey: false }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(isQuantizeShortcut(new KeyboardEvent('keydown', { key, shiftKey: true, ...options }))).toBe(false);
    }
  }
  expect(isQuantizeShortcut(new KeyboardEvent('keydown', { key: 'W', shiftKey: true }))).toBe(false);
});

it('ignores overlays inside hidden keep-alive ancestors', () => {
  const wrapper = document.createElement('div');
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  wrapper.append(dialog); document.body.append(wrapper);
  try {
    expect(hasKeyboardOverlay()).toBe(true);
    wrapper.style.display = 'none'; expect(hasKeyboardOverlay()).toBe(false);
    wrapper.style.display = ''; expect(hasKeyboardOverlay()).toBe(true);
  } finally { wrapper.remove(); }
});

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

  it('inherits editability while respecting an explicit non-editable child', () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', '');
    const child = editor.appendChild(document.createElement('span'));
    expect(isTextEntryTarget(child)).toBe(true);
    child.setAttribute('contenteditable', 'false');
    expect(isTextEntryTarget(child)).toBe(false);
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

describe('browseLoadTarget (focus-aware Performance Load routing, issue 22)', () => {
  const ac: ControlFocus = { left: 'C', right: 'B' };
  const bd: ControlFocus = { left: 'A', right: 'D' };
  const def: ControlFocus = { left: 'A', right: 'B' };

  it('← and Enter target the focused left Deck (default A)', () => {
    expect(browseLoadTarget('ArrowLeft', def)).toBe('A');
    expect(browseLoadTarget('Enter', def)).toBe('A');
  });

  it('→ targets the focused right Deck (default B)', () => {
    expect(browseLoadTarget('ArrowRight', def)).toBe('B');
  });

  it('follows left focus onto C: ← and Enter load C', () => {
    expect(browseLoadTarget('ArrowLeft', ac)).toBe('C');
    expect(browseLoadTarget('Enter', ac)).toBe('C');
    // The right side is untouched by a left flip.
    expect(browseLoadTarget('ArrowRight', ac)).toBe('B');
  });

  it('follows right focus onto D: → loads D', () => {
    expect(browseLoadTarget('ArrowRight', bd)).toBe('D');
    // The left side is untouched by a right flip.
    expect(browseLoadTarget('ArrowLeft', bd)).toBe('A');
    expect(browseLoadTarget('Enter', bd)).toBe('A');
  });

  it('covers all four Decks across the two independent sides', () => {
    const both: ControlFocus = { left: 'C', right: 'D' };
    expect(browseLoadTarget('ArrowLeft', both)).toBe('C');
    expect(browseLoadTarget('Enter', both)).toBe('C');
    expect(browseLoadTarget('ArrowRight', both)).toBe('D');
  });

  it('returns null for non-Load keys (↑/↓, space, letters)', () => {
    for (const key of ['ArrowUp', 'ArrowDown', ' ', 'a', 'k', '[', ']']) {
      expect(browseLoadTarget(key, def)).toBeNull();
    }
  });
});
