// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HFader } from './MixerStrip';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let value: number;
let disabled: boolean;
const changed = vi.fn();

beforeEach(() => {
  value = 2; disabled = false; changed.mockClear();
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 200 } as DOMRect);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

function render() {
  root.render(<HFader id="test-fader" ariaLabel="Sensitivity" label={String(value)} min={0.25} max={12}
    step={0.25} value={value} defaultValue={2} disabled={disabled} onChange={next => {
      value = next; changed(next); render();
    }} />);
}
const slider = () => host.querySelector<HTMLElement>('[role="slider"]')!;
function key(key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => slider().dispatchEvent(event));
  return event;
}
function pointer(type: string, clientX: number) {
  act(() => slider().dispatchEvent(new MouseEvent(type, { clientX, bubbles: true })));
}

it('supports accessible step, page and endpoint keys', () => {
  act(render);
  expect(slider().getAttribute('aria-label')).toBe('Sensitivity');
  expect(slider().getAttribute('aria-valuemin')).toBe('0.25');
  expect(slider().getAttribute('aria-valuemax')).toBe('12');
  expect(key('ArrowRight').defaultPrevented).toBe(true);
  expect(value).toBe(2.25);
  key('ArrowDown'); expect(value).toBe(2);
  key('PageUp'); expect(value).toBe(4.5);
  key('PageDown'); expect(value).toBe(2);
  key('Home'); expect(value).toBe(0.25);
  key('ArrowLeft'); expect(value).toBe(0.25);
  key('End'); expect(value).toBe(12);
  expect(slider().getAttribute('aria-valuenow')).toBe('12');
});

it('snaps pointer travel relative to min, clamps endpoints, and releases focus', () => {
  act(render);
  pointer('pointerdown', 151);
  expect(value).toBe(3.25);
  expect(document.activeElement).toBe(slider());
  pointer('pointermove', 500); expect(value).toBe(12);
  pointer('pointermove', 0); expect(value).toBe(0.25);
  pointer('pointerup', 0);
  expect(document.activeElement).toBe(document.body);
  pointer('pointermove', 200); expect(value).toBe(0.25);
});

it('resets on double-click and applies stepped wheel motion', () => {
  act(render); key('End');
  act(() => slider().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(value).toBe(2);
  act(() => slider().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })));
  expect(value).toBe(3.25);
});

it('keeps disabled controls inert', () => {
  disabled = true; act(render);
  expect(slider().getAttribute('aria-disabled')).toBe('true');
  expect(slider().tabIndex).toBe(-1);
  key('End'); pointer('pointerdown', 300);
  act(() => slider().dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })));
  expect(changed).not.toHaveBeenCalled();
});

it('keeps existing Performance faders continuous and outside the tab order', () => {
  act(() => root.render(<HFader label="VOL" min={0} max={1} value={0.5} defaultValue={1} onChange={changed} />));
  const fader = host.querySelector<HTMLElement>('.perf-fader')!;
  expect(fader.getAttribute('role')).toBeNull();
  expect(fader.getAttribute('tabindex')).toBeNull();
  act(() => fader.dispatchEvent(new MouseEvent('pointerdown', { clientX: 123, bubbles: true })));
  expect(changed).toHaveBeenLastCalledWith(0.115);
});
