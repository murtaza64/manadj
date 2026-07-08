// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { installNoFocusRule, stealsFocus } from './noFocusRule';

function input(type: string): HTMLInputElement {
  const el = document.createElement('input');
  el.type = type;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('stealsFocus (the global no-focus rule\'s target predicate)', () => {
  it('covers buttons, including presses on their children', () => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.appendChild(icon);
    document.body.appendChild(button);
    expect(stealsFocus(button)).toBe(true);
    expect(stealsFocus(icon)).toBe(true);
  });

  it.each(['checkbox', 'radio'])('covers input type=%s', (type) => {
    const el = input(type);
    document.body.appendChild(el);
    expect(stealsFocus(el)).toBe(true);
  });

  it('leaves range alone (the drag is the default action of mousedown)', () => {
    const el = input('range');
    document.body.appendChild(el);
    expect(stealsFocus(el)).toBe(false);
  });

  it.each(['text', 'search', 'number', 'password'])(
    'leaves typing input type=%s alone',
    (type) => {
      const el = input(type);
      document.body.appendChild(el);
      expect(stealsFocus(el)).toBe(false);
    }
  );

  it('leaves selects alone (mousedown-preventDefault would kill the picker)', () => {
    const select = document.createElement('select');
    document.body.appendChild(select);
    expect(stealsFocus(select)).toBe(false);
  });

  it('resolves a label press to the checkbox it wraps', () => {
    const label = document.createElement('label');
    const box = input('checkbox');
    const text = document.createTextNode('tempo match');
    label.appendChild(box);
    label.append(text);
    const span = document.createElement('span');
    label.appendChild(span);
    document.body.appendChild(label);
    expect(stealsFocus(label)).toBe(true);
    expect(stealsFocus(span)).toBe(true);
  });

  it('leaves a label wrapping a select or text input alone', () => {
    const label = document.createElement('label');
    label.appendChild(document.createElement('select'));
    document.body.appendChild(label);
    expect(stealsFocus(label)).toBe(false);
  });

  it('honors the data-focusable opt-out, on the control or an ancestor', () => {
    const optedButton = document.createElement('button');
    optedButton.setAttribute('data-focusable', '');
    document.body.appendChild(optedButton);
    expect(stealsFocus(optedButton)).toBe(false);

    const region = document.createElement('div');
    region.setAttribute('data-focusable', '');
    const inner = document.createElement('button');
    region.appendChild(inner);
    document.body.appendChild(region);
    expect(stealsFocus(inner)).toBe(false);
  });

  it('ignores non-element and unrelated targets', () => {
    expect(stealsFocus(null)).toBe(false);
    expect(stealsFocus(document)).toBe(false);
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(stealsFocus(div)).toBe(false);
  });
});

describe('installNoFocusRule', () => {
  it('prevents mousedown default on covered controls only, and uninstalls', () => {
    const uninstall = installNoFocusRule();
    const button = document.createElement('button');
    const text = input('text');
    document.body.append(button, text);

    const press = (el: Element) => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(press(button)).toBe(true);
    expect(press(text)).toBe(false);

    uninstall();
    expect(press(button)).toBe(false);
  });

  it('leaves range mousedown alone but blurs it on pointerup', () => {
    const uninstall = installNoFocusRule();
    const range = input('range');
    document.body.appendChild(range);

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    range.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);

    range.focus();
    expect(document.activeElement).toBe(range);

    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(document.activeElement).not.toBe(range);

    uninstall();
  });

  it('does not blur a range opted in via data-focusable', () => {
    const uninstall = installNoFocusRule();
    const region = document.createElement('div');
    region.setAttribute('data-focusable', '');
    const range = input('range');
    region.appendChild(range);
    document.body.appendChild(region);

    range.focus();
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(document.activeElement).toBe(range);

    uninstall();
  });
});
