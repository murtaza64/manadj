// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HotCue from './HotCue';
import type { HotCue as HotCueType } from '../types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];

afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
});

function renderCue(overrides: Partial<HotCueType> = {}) {
  const cue: HotCueType = {
    id: 4,
    track_id: 10,
    slot_number: 4,
    time_seconds: 32,
    label: 'DROP',
    color: '#ff4455',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
  const onDecorate = vi.fn();
  const onDelete = vi.fn();
  const onDown = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <HotCue
        slotNumber={4}
        hotCue={cue}
        disabled={false}
        isPreviewing={false}
        onDown={onDown}
        onUp={vi.fn()}
        onDelete={onDelete}
        onDecorate={onDecorate}
      />
    );
  });
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, onDecorate, onDelete, onDown };
}

describe('HotCue decoration editing', () => {
  it('deletes on Shift+left-click without triggering the cue', () => {
    const { container, onDelete, onDown } = renderCue();
    const pad = container.querySelector('.hot-cue') as HTMLButtonElement;

    act(() => pad.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      shiftKey: true,
    })));

    expect(onDelete).toHaveBeenCalledWith(4);
    expect(onDown).not.toHaveBeenCalled();
  });

  it('opens from the pad and saves a changed label and palette color', () => {
    const { container, onDecorate } = renderCue();
    const pad = container.querySelector('.hot-cue') as HTMLButtonElement;
    expect(pad.textContent).toContain('DROP');
    vi.spyOn(pad, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      bottom: 50,
    } as DOMRect);

    act(() => pad.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const dialog = document.querySelector('[role="dialog"]') as HTMLFormElement;
    expect(dialog).not.toBeNull();
    expect(dialog.style.left).toBe('100px');
    expect(dialog.style.top).toBe('56px');

    const label = dialog.querySelector('input:not([type])') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(label, '  BUILD  ');
      label.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const green = dialog.querySelector('[aria-label="Use slot 5 color"]') as HTMLButtonElement;
    act(() => green.click());
    act(() => dialog.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));

    expect(onDecorate).toHaveBeenCalledWith(4, 'BUILD', '#2ed573');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('can clear a label and delete the cue', () => {
    const { container, onDecorate, onDelete } = renderCue({ label: null });
    const pad = container.querySelector('.hot-cue') as HTMLButtonElement;
    act(() => pad.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const dialog = document.querySelector('[role="dialog"]') as HTMLFormElement;

    act(() => dialog.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })));
    expect(onDecorate).toHaveBeenCalledWith(4, null, '#ff4455');

    act(() => pad.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const deleteButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete'
    )!;
    act(() => deleteButton.click());
    expect(onDelete).toHaveBeenCalledWith(4);
  });
});
