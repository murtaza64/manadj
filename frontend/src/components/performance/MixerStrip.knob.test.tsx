// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Knob } from './MixerStrip';
import { AUTOMATION_COLORS, FILTER_LPF_COLOR } from '../../theme/automationColors';
import { strokeColorAt } from '../../editor/laneShade';
import { resetSlots, setSlot } from '../../waveform/styleSlots';

vi.mock('../../settings/persistedSettings', () => ({ writeSetting: vi.fn(), removeSetting: vi.fn() }));
const DEFAULT_EQ_COLORS = { eqLow: '#ff1a1a', eqMid: '#00ff40', eqHigh: '#3373ff' };

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

beforeEach(() => {
  resetSlots();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onChange.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<ComponentProps<typeof Knob>> = {}) {
  act(() => root.render(<Knob label="LOW" min={0} max={1} value={0.5}
    defaultValue={0.5} onChange={onChange} control="eqLow" {...props} />));
  return {
    knob: container.querySelector<HTMLElement>('.perf-knob')!,
    dial: container.querySelector<HTMLElement>('.perf-knob-dial')!,
    fill: container.querySelector<HTMLElement>('.perf-knob-ring-fill'),
  };
}

it('fills EQ with one value-dependent color, including a half-filled neutral', () => {
  const { knob, fill } = render();
  expect(knob.style.getPropertyValue('--knob-color')).toBe(DEFAULT_EQ_COLORS.eqLow);
  expect(knob.style.getPropertyValue('--knob-value-color'))
    .toBe(strokeColorAt('eq', DEFAULT_EQ_COLORS.eqLow, 1));
  expect(fill!.style.background).toContain('conic-gradient(from 225deg');
  expect(fill!.style.background).toContain('var(--knob-value-color) 0deg 135deg');
  expect(fill!.style.background).not.toContain('rgba(');
  expect(render({ value: 0 }).fill!.style.background).toBe('none');
  expect(render({ value: 1 }).fill!.style.background).toContain('270deg');
});

it.each(['eqLow', 'eqMid', 'eqHigh'] as const)('%s reaches full color at neutral and glows only above neutral', (control) => {
  const shade = (value: number, ghost: number | null = null) => {
    const { knob } = render({ control, value, ghost });
    return {
      color: knob.style.getPropertyValue('--knob-value-color'),
      glow: knob.style.getPropertyValue('--knob-glow'),
    };
  };
  expect(shade(0.25)).toEqual({ color: strokeColorAt('eq', DEFAULT_EQ_COLORS[control], 0.5), glow: 'none' });
  const neutral = shade(0.5);
  expect(neutral).toEqual({ color: strokeColorAt('eq', DEFAULT_EQ_COLORS[control], 1), glow: 'none' });
  expect(shade(0.75)).toEqual({ color: neutral.color, glow: `drop-shadow(0 0 2px ${DEFAULT_EQ_COLORS[control]})` });
  expect(shade(1)).toEqual({ color: neutral.color, glow: `drop-shadow(0 0 4px ${DEFAULT_EQ_COLORS[control]})` });
  expect(shade(0, 1)).toEqual(shade(1));
  expect(shade(1, 0.5)).toEqual(neutral);
});

it.each(['eqLow', 'eqMid', 'eqHigh'] as const)('%s follows full waveform preferences live, including style defaults and reset', (control) => {
  const { knob } = render({ control, value: 0.75 });
  act(() => setSlot('full', { params: { colors: [[1, 0.5, 0], [0.5, 0, 1], [0, 1, 1]] } }));
  const expected = { eqLow: '#ff8000', eqMid: '#8000ff', eqHigh: '#00ffff' }[control];
  expect(knob.style.getPropertyValue('--knob-color')).toBe(expected);
  expect(knob.style.getPropertyValue('--knob-value-color')).toBe(strokeColorAt('eq', expected, 1));
  expect(knob.style.getPropertyValue('--knob-glow')).toBe(`drop-shadow(0 0 2px ${expected})`);
  act(() => setSlot('minimap', { params: { colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] } }));
  expect(knob.style.getPropertyValue('--knob-color')).toBe(expected);
  act(() => setSlot('full', { styleId: 'layered-opaque' }));
  expect(knob.style.getPropertyValue('--knob-color')).toBe(expected);
  act(() => setSlot('full', { params: { colors: null } }));
  expect(knob.style.getPropertyValue('--knob-color')).toBe({ eqLow: '#1438ff', eqMid: '#ff8f00', eqHigh: '#ffffff' }[control]);
  act(() => resetSlots());
  expect(knob.style.getPropertyValue('--knob-color')).toBe(DEFAULT_EQ_COLORS[control]);
});

it('fills filter from center with warm LPF and cool HPF shading', () => {
  const props = { control: 'filter' as const, min: -1, max: 1, defaultValue: 0 };
  expect(render({ ...props, value: 0 }).fill!.style.background).toBe('none');
  const low = render({ ...props, value: -0.5 });
  expect(low.knob.style.getPropertyValue('--knob-value-color'))
    .toBe(strokeColorAt('filter', FILTER_LPF_COLOR, 0.25));
  expect(low.fill!.style.background).toContain('67.5deg');
  const high = render({ ...props, value: 0.5 });
  expect(high.knob.style.getPropertyValue('--knob-value-color'))
    .toBe(strokeColorAt('filter', AUTOMATION_COLORS.filter, 0.75));
  expect(high.fill!.style.background).toContain('202.5deg');
  expect(high.knob.style.getPropertyValue('--knob-glow')).toBe('none');
});

it('uses center-anchored silver trim and clamps values to physical stops', () => {
  expect(render({ control: 'trim' }).fill!.style.background).toBe('none');
  const { knob, fill } = render({ control: 'trim', value: 2 });
  expect(knob.style.getPropertyValue('--knob-color')).toBe(AUTOMATION_COLORS.trim);
  expect(fill!.style.background).toContain('270deg');
  expect(fill!.style.background).not.toContain('540deg');
});

it('follows audible automation while preserving the base pointer and takeover hint', () => {
  const { fill, knob } = render({ value: 0, ghost: 1, takeover: 'up' });
  expect(fill!.style.background).toContain('270deg');
  expect(knob.classList.contains('perf-takeover-up')).toBe(true);
  expect(container.querySelector<HTMLElement>('.perf-knob-ghost')!.style.transform).toBe('rotate(135deg)');
  expect(container.querySelector<HTMLElement>('.perf-base-dim')!.style.transform).toBe('rotate(-135deg)');
  expect(render({ value: 0, ghost: null }).fill!.style.background).toBe('none');
});

it('preserves wheel, reset and drag behavior; unstyled knobs have no color ring', () => {
  const { dial } = render();
  act(() => dial.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 })));
  expect(onChange).toHaveBeenLastCalledWith(0.6);
  act(() => dial.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(onChange).toHaveBeenLastCalledWith(0.5);
  dial.setPointerCapture = vi.fn();
  const pointer = (type: string, y: number) => act(() => dial.dispatchEvent(
    new MouseEvent(type, { bubbles: true, clientY: y })
  ));
  pointer('pointerdown', 150);
  pointer('pointermove', 75);
  expect(onChange).toHaveBeenLastCalledWith(1);
  pointer('pointerup', 75);
  onChange.mockClear();
  pointer('pointermove', 0);
  expect(onChange).not.toHaveBeenCalled();
  expect(render({ control: undefined }).fill).toBeNull();
});
