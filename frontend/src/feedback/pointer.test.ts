// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { describeElement, pickElement } from './pointer';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('describeElement', () => {
  it('captures tag, id, role, label, short text and bounds', () => {
    const button = document.createElement('button');
    button.id = 'play';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Play deck A');
    button.textContent = 'Play';
    document.body.append(button);
    const info = describeElement(button);
    expect(info).toMatchObject({
      tag: 'button', id: 'play', role: 'button', label: 'Play deck A', text: 'Play',
    });
    expect(info.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('never describes input/textarea/select contents or private subtrees', () => {
    const input = document.createElement('input');
    input.value = 'typed secret value';
    document.body.append(input);
    expect(describeElement(input).text).toBeNull();

    const select = document.createElement('select');
    const option = document.createElement('option');
    option.textContent = 'Private playlist name';
    select.append(option);
    document.body.append(select);
    expect(describeElement(select).text).toBeNull();

    const privateZone = document.createElement('div');
    privateZone.setAttribute('data-feedback-private', '');
    const inner = document.createElement('span');
    inner.textContent = 'hidden text';
    inner.id = 'private-id';
    inner.setAttribute('aria-label', 'private-label');
    privateZone.append(inner);
    document.body.append(privateZone);
    expect(describeElement(inner)).toMatchObject({ text: null, id: null, label: null });
    expect((describeElement(privateZone.parentElement!).text ?? "")).not.toContain("hidden text");
  });

  it('redacts secret-looking text and bounds length', () => {
    const el = document.createElement('div');
    el.textContent = 'auth token=abc123def456';
    document.body.append(el);
    expect(describeElement(el).text).not.toContain('abc123def456');

    const long = document.createElement('div');
    long.textContent = 'x'.repeat(500);
    document.body.append(long);
    // Long free text is dropped rather than partially leaked.
    expect(describeElement(long).text).toBeNull();
  });
});

describe('pickElement', () => {
  it('describes the clicked element and swallows the paired click', async () => {
    const target = document.createElement('button');
    target.textContent = 'Cue';
    let clicked = 0;
    target.addEventListener('click', () => { clicked += 1; });
    document.body.append(target);
    const doc = document as Omit<Document, 'elementFromPoint'> & { elementFromPoint?: (x: number, y: number) => Element | null };
    const had = typeof doc.elementFromPoint === 'function';
    const original = doc.elementFromPoint;
    doc.elementFromPoint = () => target;
    try {
      const pending = pickElement();
      const overlay = document.querySelector('.feedback-picker')!;
      expect(overlay).not.toBeNull();
      overlay.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
      window.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await expect(pending).resolves.toMatchObject({ tag: 'button', text: 'Cue' });
      expect(clicked).toBe(0);
      expect(document.querySelector('.feedback-picker')).toBeNull();
    } finally {
      if (had) doc.elementFromPoint = original;
      else delete doc.elementFromPoint;
    }
  });

  it('Esc cancels with null and removes the overlay', async () => {
    const pending = pickElement();
    expect(document.querySelector('.feedback-picker')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(pending).resolves.toBeNull();
    expect(document.querySelector('.feedback-picker')).toBeNull();
  });
});
